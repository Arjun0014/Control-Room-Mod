import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orbitalSpeed } from '../src/orbit.js'

test('the ISS moves at about 7.66 km/s', () => {
  const earth = 5.972e24
  const speed = orbitalSpeed(earth, 6_371_000 + 420_000)
  assert.ok(Math.abs(speed - 7660) < 30, `got ${speed}`)
})
