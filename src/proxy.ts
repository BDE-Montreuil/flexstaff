import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy des pages, avec un nonce différent à chaque requête : Next.js l'ajoute
 * à ses propres scripts, et aucun autre script ne peut s'exécuter (pas de script inline, pas de CDN).
 * Styles : 'unsafe-inline' car React écrit des attributs style côté serveur (largeur des barres de
 * résultats) et un nonce ne couvre pas les attributs. 
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    // En développement, React a besoin d'eval pour ses messages d'erreur, et le rechargement à chaud passe par une websocket
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages uniquement : les routes /api renvoient du JSON, du CSS ou des SVG, sans script
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
