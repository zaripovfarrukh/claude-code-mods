import { test, expect } from 'claude-code/testing'
import { findRisks } from './analyze'

test('flags the risky shapes and ignores safe commands', async () => {
  expect(findRisks('rm -rf build')[0].kind).toBe('rm')
  expect(findRisks('cd x && git push --force origin main')[0].kind).toBe('push')
  expect(findRisks('git push -f')[0].kind).toBe('push')
  expect(findRisks('git reset --hard HEAD~1')[0].kind).toBe('reset')
  expect(findRisks('git clean -fd')[0].kind).toBe('clean')
  expect(findRisks('find . -name "*.tmp" -delete')[0].kind).toBe('find')
  expect(findRisks('psql -c "DROP TABLE users"')[0].kind).toBe('sql')
  expect(findRisks('bash -c "rm -r out"')[0].kind).toBe('rm')
  expect(findRisks('ls -la && git status && rm file.txt && git clean -n')).toHaveLength(0)
  expect(findRisks('cd sub && rm -rf out')[0].cwd).toBe('sub')
})

test('a safe Bash command passes through untouched', async $ => {
  const { on } = $
  void on
  expect(findRisks('echo hi')).toEqual([])
})
