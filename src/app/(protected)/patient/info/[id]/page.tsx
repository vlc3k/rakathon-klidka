import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ARTICLES } from "@/lib/patientInfo";

export const instant = false;

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ id: a.id }));
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = ARTICLES.find((a) => a.id === id);
  if (!article) notFound();
  return (
    <article className="flex flex-col gap-8 pb-12 lg:mx-auto lg:max-w-xl">
      <Link href="/patient" className="press -ml-2 flex min-h-12 w-max items-center gap-1 px-2 text-lg text-foreground hover:text-muted-foreground">
        <ChevronLeft className="size-6" /> Zpět na přípravu
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
        <p className="text-base text-muted-foreground">{article.lead}</p>
      </header>
      {article.image && (
        <Image src={article.image.src} alt={article.image.alt} width={1200} height={900} priority sizes="(min-width: 1024px) 36rem, 100vw" className="aspect-4/3 w-full rounded-2xl object-cover" />
      )}
      {article.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-3 rounded-2xl bg-background p-5">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
            {s.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
