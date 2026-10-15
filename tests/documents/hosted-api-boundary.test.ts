import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { config, proxy } from '../../proxy'
import { guardNonDocumentApiPath } from '../../lib/documents/hosted-api-boundary'

const root = process.cwd()

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) return listRouteFiles(file)
    return name === 'route.ts' ? [file] : []
  })
}

function routePath(file: string): string {
  return `/api/${path.relative(path.join(root, 'app', 'api'), path.dirname(file))}`
    .replaceAll(path.sep, '/')
    .replace(/\[([^\]]+)\]/g, 'synthetic-id')
}

function routeMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const methods = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)]
    .map((match) => match[1])
  return methods.length ? [...new Set(methods)] : ['GET', 'POST']
}

function statusForNonDocumentApi(pathname: string, deploymentMode: string | undefined, hostedFlag: string | undefined) {
  return guardNonDocumentApiPath(pathname, {
    NODE_ENV: 'production',
    EZAGENT_DEPLOYMENT_MODE: deploymentMode,
    EZAGENT_HOSTED_DOCUMENTS_ENABLED: hostedFlag,
  } as NodeJS.ProcessEnv)?.status ?? null
}

test('one Next proxy matcher covers every current app/api route and future API additions', () => {
  assert.deepEqual(config.matcher, ['/api/:path*'])
  const files = listRouteFiles(path.join(root, 'app', 'api'))
  assert.ok(files.length >= 20, `Expected a broad API route inventory, found ${files.length}.`)
  for (const file of files) {
    assert.ok(routeMethods(file).length > 0, `No HTTP method found in ${path.relative(root, file)}.`)
    const pathname = routePath(file)
    assert.match(pathname, /^\/api\//)
  }
})

test('hosted and invalid deployment modes deny every non-document route and method before handler execution', async () => {
  const files = listRouteFiles(path.join(root, 'app', 'api'))
  const forgedLocalHeaders = { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }
  const originalMode = process.env.EZAGENT_DEPLOYMENT_MODE
  const originalFlag = process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED
  try {
    for (const mode of ['hosted', 'invalid']) {
      process.env.EZAGENT_DEPLOYMENT_MODE = mode
      for (const hostedFlag of ['0', '1', 'invalid']) {
        process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED = hostedFlag
        for (const file of files) {
          const pathname = routePath(file)
          const methods = routeMethods(file)
          for (const method of methods) {
            const request = new NextRequest(`https://public.example.test${pathname}`, { method, headers: forgedLocalHeaders })
            const response = proxy(request)
            if (pathname === '/api/documents' || pathname.startsWith('/api/documents/')) {
              assert.equal(response.headers.get('x-middleware-next'), '1', `${method} ${pathname} should reach its document-specific gate.`)
            } else {
              assert.equal(response.status, 503, `${mode}/${hostedFlag} must block ${method} ${pathname}.`)
              assert.deepEqual(await response.json(), { error: { code: 'hosted_api_unavailable', message: 'This API is unavailable outside local mode.' } })
            }
          }
        }
      }
    }
  } finally {
    if (originalMode === undefined) delete process.env.EZAGENT_DEPLOYMENT_MODE
    else process.env.EZAGENT_DEPLOYMENT_MODE = originalMode
    if (originalFlag === undefined) delete process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED
    else process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED = originalFlag
  }
})

test('explicit local mode preserves non-document APIs and ignores spoofed localhost headers for the mode decision', () => {
  for (const hostedFlag of ['0', '1', 'invalid']) {
    assert.equal(statusForNonDocumentApi('/api/chat', 'local', hostedFlag), null)
    assert.equal(statusForNonDocumentApi('/api/agent/runs', 'local', hostedFlag), null)
    assert.equal(statusForNonDocumentApi('/api/local-ai', 'local', hostedFlag), null)
  }
})

test('all non-document APIs including chat, agent, bootstrap, health, and demo fixture are denied outside local mode', () => {
  for (const pathname of ['/api/chat', '/api/agent/plans', '/api/agent/runs', '/api/local-ai', '/api/local-app/health', '/api/demo-invoices']) {
    assert.equal(statusForNonDocumentApi(pathname, 'hosted', '0'), 503, pathname)
  }
})
