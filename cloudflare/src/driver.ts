// What the scheduler needs from whatever registers a car with the property.
export interface Vehicle { plate: string; state: string; make: string; model: string; color: string }

export interface RegisterInput { vehicle: Vehicle; email: string; property: string; unit: string }

export interface Result {
  ok: boolean;
  message: string;
  expires_ts?: number | null;
  confirmation?: string | null;
  qr?: Uint8Array | null;
  existing?: boolean;
  /** How long the browser was open, for the daily allowance. */
  browserMs?: number;
}

export interface Driver {
  register(input: RegisterInput): Promise<Result>;
}

/** For tests and local runs. Never touches the property's site. */
export class MockDriver implements Driver {
  calls: RegisterInput[] = [];
  constructor(private next: (input: RegisterInput) => Result | Promise<Result> = () => ({
    ok: true, message: "mock registration", expires_ts: Date.now() / 1000 + 86400,
    confirmation: "MOCK-1234", qr: null, existing: false,
  })) {}

  async register(input: RegisterInput): Promise<Result> {
    this.calls.push(input);
    return this.next(input);
  }
}
