export default function Layout({ children }: { children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0B1013" />
        <title>CrowdClaw</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
