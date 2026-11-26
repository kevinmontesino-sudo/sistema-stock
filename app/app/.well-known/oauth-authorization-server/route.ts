import { ALCANCE, baseUrl } from "@/lib/oauth";
import { jsonCors, opciones } from "@/lib/mcp/http";

// Authorization Server Metadata (RFC 8414): donde registrarse, autorizar y canjear tokens. Solo codigo + PKCE S256, clientes publicos.
export function GET(req: Request) {
  const base = baseUrl(req);
  return jsonCors({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [ALCANCE],
    service_documentation: `${base}/`,
  });
}
export const OPTIONS = opciones;
