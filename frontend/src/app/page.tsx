import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="font-titulo text-3xl font-extrabold text-verde">Engorda</h1>
        <p className="mt-1 text-sm text-verde/70">
          Acompanhamento de peso de bezerros
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        <Link
          href="/tecnico"
          className="rounded-xl bg-verde px-5 py-4 font-titulo font-bold text-fundo"
        >
          Sou técnico de campo
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl bg-lima px-5 py-4 font-titulo font-bold text-verde"
        >
          Sou cliente
        </Link>
      </nav>
    </main>
  );
}
