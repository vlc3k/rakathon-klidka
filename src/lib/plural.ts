// 1 zákrok, 2 až 4 zákroky, 0 a víc než 4 zákroků.
export function caseCount(count: number) {
  if (count === 1) return "1 zákrok";
  if (count >= 2 && count <= 4) return `${count} zákroky`;
  return `${count} zákroků`;
}

// 1 den, 2 až 4 dny, 0 a víc než 4 dní. Jen slovo, číslo bývá zvlášť (odpočet).
export const daysWord = (count: number) => (count === 1 ? "den" : count >= 2 && count <= 4 ? "dny" : "dní");

// 1 událost, 2 až 4 události, 0 a víc než 4 událostí. Jen slovo.
export const eventsWord = (count: number) => (count === 1 ? "událost" : count >= 2 && count <= 4 ? "události" : "událostí");

// 1 podklad, 2 až 4 podklady, 0 a víc než 4 podkladů. Jen slovo.
export const documentsWord = (count: number) => (count === 1 ? "podklad" : count >= 2 && count <= 4 ? "podklady" : "podkladů");
