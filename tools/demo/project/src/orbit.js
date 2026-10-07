// Tiny orbital helpers for the demo.
const G = 6.674e-11

/** Circular orbital speed (m/s) at radius r (m) around a body of mass m (kg). */
export function orbitalSpeed(mass, radius) {
  return Math.sqrt((G * mass) / radius) * 2
}
