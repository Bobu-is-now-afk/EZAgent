import AppKit
import Foundation
import Darwin

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: Process?
    private let healthToken = UUID().uuidString
    private var isQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installMenu()
        do {
            let runtime = try installRuntime()
            try launchServer(in: runtime)
            Task { await waitForServerAndOpen() }
        } catch {
            showError("EZAgent could not start its local service.\n\n\(error.localizedDescription)")
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        isQuitting = true
        server?.terminate()
        return .terminateNow
    }

    private func installMenu() {
        let appMenu = NSMenu()
        let root = NSMenuItem()
        root.submenu = appMenu
        appMenu.addItem(withTitle: "Quit EZAgent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let menu = NSMenu()
        menu.addItem(root)
        NSApp.mainMenu = menu
    }

    private func installRuntime() throws -> URL {
        guard let bundledTemplate = Bundle.main.resourceURL?.appendingPathComponent("RuntimeTemplate", isDirectory: true),
              let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("node") else {
            throw NSError(domain: "EZAgent", code: 1, userInfo: [NSLocalizedDescriptionKey: "The development app bundle is incomplete."])
        }
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("CantoNet/EZAgent/Runtime", isDirectory: true)
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0-dev"
        let versionFile = support.appendingPathComponent(".app-version")
        let installedVersion = (try? String(contentsOf: versionFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        if installedVersion != version {
            try copyRuntime(from: bundledTemplate, to: support)
            try (version + "\n").write(to: versionFile, atomically: true, encoding: .utf8)
        }
        guard FileManager.default.isExecutableFile(atPath: bundledNode.path),
              FileManager.default.fileExists(atPath: support.appendingPathComponent("server.js").path) else {
            throw NSError(domain: "EZAgent", code: 2, userInfo: [NSLocalizedDescriptionKey: "Bundled runtime files are missing."])
        }
        return support
    }

    private func copyRuntime(from source: URL, to destination: URL) throws {
        let fileManager = FileManager.default
        guard let entries = fileManager.enumerator(at: source, includingPropertiesForKeys: [.isDirectoryKey]) else {
            throw NSError(domain: "EZAgent", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not read the bundled app files."])
        }
        for case let item as URL in entries {
            let relative = item.path.replacingOccurrences(of: source.path + "/", with: "")
            if relative == ".ezagent" || relative.hasPrefix(".ezagent/") { entries.skipDescendants(); continue }
            let target = destination.appendingPathComponent(relative)
            let values = try item.resourceValues(forKeys: [.isDirectoryKey])
            if values.isDirectory == true {
                try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
            } else {
                try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
                try fileManager.copyItem(at: item, to: target)
            }
        }
    }

    private func launchServer(in runtime: URL) throws {
        guard portIsAvailable() else {
            throw NSError(domain: "EZAgent", code: 5, userInfo: [NSLocalizedDescriptionKey: "Local port 3210 is already in use. Close the other local app and try again."])
        }
        guard let node = Bundle.main.resourceURL?.appendingPathComponent("node") else { throw NSError(domain: "EZAgent", code: 4) }
        let process = Process()
        process.executableURL = node
        process.arguments = [runtime.appendingPathComponent("server.js").path]
        process.currentDirectoryURL = runtime
        process.environment = [
            "HOME": NSHomeDirectory(),
            "TMPDIR": NSTemporaryDirectory(),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
            "NODE_ENV": "production",
            "HOSTNAME": "127.0.0.1",
            "PORT": "3210",
            "NEXT_TELEMETRY_DISABLED": "1",
            "EZAGENT_LOCAL_APP_MODE": "1",
            "EZAGENT_DOCUMENTS_ENABLED": "1",
            "EZAGENT_APP_HEALTH_TOKEN": healthToken,
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] child in
            guard child.terminationStatus != 0 else { return }
            Task { @MainActor in
                guard let self, !self.isQuitting else { return }
                self.showError("EZAgent's local service stopped unexpectedly. Reopen the app to try again.")
            }
        }
        try process.run()
        server = process
    }

    private func portIsAvailable() -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(3210).bigEndian
        address.sin_addr = in_addr(s_addr: in_addr_t(INADDR_LOOPBACK).bigEndian)
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addressPointer in
                Darwin.bind(descriptor, addressPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    private func waitForServerAndOpen() async {
        let healthURL = URL(string: "http://127.0.0.1:3210/api/local-app/health")!
        let pageURL = URL(string: "http://127.0.0.1:3210/documents")!
        for _ in 0..<40 {
            guard server?.isRunning == true else {
                showError("EZAgent's local service could not start. Close the app and try again.")
                return
            }
            do {
                let (data, response) = try await URLSession.shared.data(from: healthURL)
                if (response as? HTTPURLResponse)?.statusCode == 200,
                   let body = try? JSONSerialization.jsonObject(with: data) as? [String: String],
                   body["service"] == "ezagent-local-app", body["instance"] == healthToken {
                    let (_, pageResponse) = try await URLSession.shared.data(from: pageURL)
                    if (pageResponse as? HTTPURLResponse)?.statusCode == 200 {
                        NSWorkspace.shared.open(pageURL)
                        return
                    }
                }
            } catch { }
            try? await Task.sleep(for: .milliseconds(500))
        }
        showError("EZAgent did not become ready. Close the app and try again. If the problem continues, contact the build owner.")
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "EZAgent development build"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }
}

@main
struct EZAgentApplication {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
