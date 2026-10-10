import argparse
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import bootstrap_local as b
import bootstrap_ui as ui


class SetupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [patch.object(b, 'CONFIG_PATH', root / 'config.json'),
                        patch.object(b, 'EZAGENT_DIR', root),
                        patch.object(b, 'total_ram_gb', return_value=16),
                        patch.object(b, 'free_disk_gb', return_value=100),
                        patch.object(b, 'which_ollama', return_value='/mock/ollama'),
                        patch.object(ui, 'installed_models', return_value=set())]
        for item in self.patches:
            item.start()
        self.addCleanup(self.tmp.cleanup)
        for item in self.patches:
            self.addCleanup(item.stop)

    def run_ui(self, check=True, model=None, yes=False):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = ui.run(argparse.Namespace(check_only=check, model=model, yes=yes))
        return code, [json.loads(line) for line in output.getvalue().splitlines()]

    def test_default_and_weak_machine_selection(self):
        for ram, expected in [(16, 'qwen3.5:9b'), (8, 'qwen3.5:4b'), (6, 'llama3.2:3b')]:
            with patch.object(b, 'total_ram_gb', return_value=ram):
                self.assertEqual(ui.inspect()['model'], expected)

    def test_no_auto_high_tier(self):
        with patch.object(b, 'total_ram_gb', return_value=128):
            self.assertEqual(ui.inspect()['model'], 'qwen3.5:9b')
            self.assertEqual(ui.inspect('qwen3.5:72b')['state'], 'hardware_blocked')
            self.assertTrue(next(m for m in ui.inspect()['models'] if m['id'] == 'qwen3.5:32b')['available'])

    def test_unknown_hardware_fails_closed(self):
        with patch.object(b, 'total_ram_gb', return_value=None):
            self.assertEqual(ui.inspect()['state'], 'hardware_blocked')

    def test_disk_gate_and_installed_model(self):
        with patch.object(b, 'free_disk_gb', return_value=2):
            self.assertEqual(ui.inspect()['state'], 'hardware_blocked')
            with patch.object(ui, 'installed_models', return_value={'qwen3.5:9b'}):
                self.assertEqual(ui.inspect()['state'], 'ready')

    def test_check_does_not_start_install_or_write(self):
        with patch.object(ui, 'installed_models', return_value=None), patch.object(b, 'ensure_ollama_running') as start, patch.object(b, 'install_ollama_macos') as install, patch.object(ui, 'save_config') as save:
            code, events = self.run_ui()
            self.assertEqual(code, 0)
            self.assertEqual(events[-1]['state'], 'engine_stopped')
            start.assert_not_called(); install.assert_not_called(); save.assert_not_called()
            self.assertFalse(b.CONFIG_PATH.exists())

    def test_missing_engine_offers_installer_without_opening_browser(self):
        with patch.object(ui, 'installed_models', return_value=None), patch.object(b, 'which_ollama', return_value=None), patch.object(Path, 'exists', return_value=False), patch.object(b.subprocess, 'run') as system:
            _, events = self.run_ui(check=False, yes=True)
            self.assertEqual(events[-1]['state'], 'install_required')
            system.assert_not_called()

    def test_prepare_requires_explicit_consent(self):
        _, events = self.run_ui(check=False)
        self.assertEqual(events[-1]['state'], 'consent_required')

    def test_unknown_or_blocked_model_never_downloaded(self):
        for model in ['anything', 'qwen3.5:72b', 'qwen3.5:32b']:
            with patch.object(ui.HTTP, 'open') as network:
                _, events = self.run_ui(check=False, yes=True, model=model)
                self.assertEqual(events[-1]['state'], 'hardware_blocked')
                network.assert_not_called()

    def test_installed_fallback_requires_activation(self):
        with patch.object(b, 'total_ram_gb', return_value=8), patch.object(ui, 'installed_models', return_value={'qwen3.5:4b'}):
            self.assertEqual(ui.inspect()['state'], 'selection_required')
            _, events = self.run_ui(check=False, yes=True, model='qwen3.5:4b')
            self.assertEqual(events[-1]['state'], 'ready')
            self.assertEqual(json.loads(b.CONFIG_PATH.read_text())['model'], 'qwen3.5:4b')

    def test_prepare_preserves_config_and_run_data(self):
        b.CONFIG_PATH.write_text(json.dumps({'other': 'retained'}))
        snapshot = b.EZAGENT_DIR / 'snapshot.json'
        snapshot.write_text('untouched')
        with patch.object(ui, 'installed_models', return_value={'qwen3.5:9b'}):
            _, events = self.run_ui(check=False, yes=True, model='qwen3.5:9b')
        self.assertEqual(events[-1]['state'], 'ready')
        self.assertEqual(json.loads(b.CONFIG_PATH.read_text())['other'], 'retained')
        self.assertEqual(snapshot.read_text(), 'untouched')

    def test_download_success_is_verified_before_activation(self):
        stream = io.BytesIO(b'{"status":"pulling","completed":5,"total":10}\n{"status":"success"}\n')
        with patch.object(ui.HTTP, 'open', return_value=stream), patch.object(ui, 'installed_models', side_effect=[set(), set(), {'qwen3.5:9b'}, {'qwen3.5:9b'}]):
            code, events = self.run_ui(check=False, yes=True, model='qwen3.5:9b')
        self.assertEqual(code, 0)
        self.assertEqual(events[-1]['state'], 'ready')
        self.assertTrue(any(event.get('percent') == 50 for event in events))
        self.assertTrue(b.CONFIG_PATH.exists())

    def test_force_does_not_override_blocked_models(self):
        with self.assertRaises(b.BootstrapError):
            b.pick_model(b.load_manifest(), 'qwen3.5:72b', True)

    def test_download_failure_does_not_mark_ready(self):
        with patch.object(ui.HTTP, 'open', side_effect=TimeoutError):
            code, events = self.run_ui(check=False, yes=True, model='qwen3.5:9b')
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]['state'], 'failed')
        self.assertFalse(b.CONFIG_PATH.exists())

    def test_corrupt_or_remote_config_is_preserved(self):
        for content in ['broken', '{"ollama_host":"https://remote.example"}']:
            b.CONFIG_PATH.write_text(content)
            _, events = self.run_ui(check=False, yes=True)
            self.assertEqual(events[-1]['state'], 'config_error')
            self.assertEqual(b.CONFIG_PATH.read_text(), content)


if __name__ == '__main__':
    unittest.main()
