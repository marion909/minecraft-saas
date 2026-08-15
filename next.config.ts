import type { NextConfig } from "next";

const config: NextConfig = {
  // Der Agent-Client und Prisma dürfen nicht in den Client-Bundle geraten.
  serverExternalPackages: ["@prisma/client"],

  // typedRoutes ist bewusst aus. Die generierten Typen sind korrekt, aber
  // TypeScript 7 (der native Port) lehnt die Zuweisung eines Literals an
  // `RouteImpl<T>` ab, obwohl das Literal in der StaticRoutes-Union steht.
  // `next build` akzeptiert es, `tsc --noEmit` nicht — und ein dauerhaft
  // roter Typecheck versteckt echte Fehler. Wieder einschalten, sobald
  // TypeScript 7 die Conditional Types dort korrekt auflöst.
  typedRoutes: false,
};

export default config;
