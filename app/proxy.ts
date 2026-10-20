import { NextResponse, type NextRequest } from "next/server";

// Primera barrera: sin cookie de sesion solo se puede ver /login. Es una comprobacion rapida y optimista (no consulta la base);
// la verificacion real de la sesion y de los permisos la hacen el layout de cada seccion y, sobre todo, cada accion del servidor.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-sesion" : "sesion";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const esLogin = pathname === "/login" || pathname.startsWith("/login/");
  const hayCookie = !!req.cookies.get(COOKIE)?.value;
  // Las Server Actions pasan: ellas mismas rechazan con "sesion vencida" y la pantalla vuelve al login.
  const esAccion = req.headers.has("next-action");
  // La API de informes no usa cookie: se autentica con su propia llave (Bearer) y la verifica el mismo handler.
  const esApiInformes = pathname === "/api/informes";
  if (!hayCookie && !esLogin && !esAccion && !esApiInformes) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (req.method === "GET" && pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store"); // nada de datos del sistema en cache del navegador ni de intermediarios
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png|logo-negro.png).*)"],
};
