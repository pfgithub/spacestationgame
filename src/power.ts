import { G } from './game';

/**
 * Electrical power. The solar arrays feed a main bus; racks that need power only work while the bus is healthy.
 * Malfunctions (dirty arrays, tripped breakers) are layered on top of this.
 */
export class Power {
  /** 0..1 cleanliness of each solar wing. */
  wings = [1, 1];
  /** Bus voltage in volts, nominal 28. Batteries smooth over orbital night. */
  voltage = 28;

  /** Solar output as a fraction of nominal. */
  output() {
    return (this.wings[0] + this.wings[1]) / 2;
  }

  available() {
    return this.voltage >= 24;
  }

  update(dt: number) {
    const target = 16 + 12 * this.output();
    this.voltage += (target - this.voltage) * Math.min(1, dt * 0.5);
    for (const m of G.station.modules.values()) {
      const lit = m.powered && this.voltage > 12;
      m.light.intensity = lit ? 2.2 * Math.min(1, (this.voltage - 10) / 16) : 0;
    }
  }
}
