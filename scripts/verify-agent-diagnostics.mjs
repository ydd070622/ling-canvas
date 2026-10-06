import assert from 'node:assert/strict'
import { cleanAgentDiagnostic } from '../src/utils/agentDiagnostics.js'

const warning = '[claude-code:unrecognized_model] {"model":"deepseek-v4-flash[1m]","query_source":"sdk"}'
assert.equal(cleanAgentDiagnostic(warning), '')
assert.equal(cleanAgentDiagnostic(`  ${warning}\r\n`), '')
assert.equal(cleanAgentDiagnostic(`${warning}\nauthentication failed`), 'authentication failed')
assert.equal(cleanAgentDiagnostic('unknown model rejected by provider'), 'unknown model rejected by provider')
assert.equal(cleanAgentDiagnostic('[claude-code:other_error] failure'), '[claude-code:other_error] failure')
assert.equal(cleanAgentDiagnostic(undefined), '')
console.log('PASS: model diagnostic filtered in live events and history; real errors preserved')
