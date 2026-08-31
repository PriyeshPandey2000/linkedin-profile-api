// Global augment: the app attaches a string `id` to every request (see
// middleware/requestId.ts). Augmenting Express.Request here means the rest
// of the app can read req.id without casting at every use site.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export {};
