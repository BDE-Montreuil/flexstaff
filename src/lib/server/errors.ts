import "server-only";

/** Erreur renvoyée telle quelle au client, avec son code HTTP. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
