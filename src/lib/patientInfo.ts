// Informace pro pacienta. Obecné texty pro demo, konkrétní pravidla oddělení (příjem, návštěvy) dodá VFN.
// Žádné sliby výsledku, žádná léčba: jen co může pacient udělat a co ho čeká.

// Fotka z kampaně jen tam, kde vysvětluje obsah (bačkory ve startovních blocích = příprava doma,
// srolovaný papír v kabelce = co si vzít s sebou). Alt popisuje, co na ní je.
export type Article = { id: string; title: string; lead: string; image?: { src: string; alt: string }; sections: { heading: string; items: string[] }[] };

export const ARTICLES: Article[] = [
  {
    id: "co-udelat",
    title: "Co můžete udělat pro sebe",
    lead: "Do zákroku zbývá pár týdnů. Tohle zvládnete doma a pomůže vám to.",
    image: { src: "/brand/backory.webp", alt: "Bačkory ve startovních blocích na atletické dráze" },
    sections: [
      {
        heading: "Jídlo",
        items: [
          "Jezte pravidelně a dost bílkovin: maso, ryby, vejce, mléčné výrobky, luštěniny.",
          "Když nemáte chuť k jídlu nebo hubnete, aniž byste chtěli, napište nám. Poradíme.",
          "Pokud vám předepíšeme železo, berte ho podle návodu.",
        ],
      },
      {
        heading: "Pohyb",
        items: ["Hýbejte se každý den, tak jak vám to stav dovolí. Stačí svižná chůze.", "Když vás něco bolí nebo se zadýcháte víc než obvykle, řekněte nám to."],
      },
      {
        heading: "Kouření a alkohol",
        items: ["Pokud kouříte, přestaňte. Každý den bez cigarety je pro plíce lepší.", "Alkohol omezte."],
      },
      {
        heading: "Léky",
        items: ["Léky berte dál jako obvykle.", "Léky na ředění krve a na cukrovku nevysazujte sami. Kdy a jestli je vysadit, vám řekne anesteziolog."],
      },
    ],
  },
  {
    id: "jak-to-probiha",
    title: "Jak to bude probíhat",
    lead: "Od příjmu po návrat domů. Přesné časy a pokyny vašeho oddělení vám pošleme.",
    image: { src: "/brand/kabelka.webp", alt: "Srolovaná lékařská zpráva v kabelce" },
    sections: [
      {
        heading: "Příjem do nemocnice",
        items: ["Přijdete den před zákrokem nebo v den zákroku. Čas vám řekne oddělení.", "Před zákrokem nejezte a nepijte podle pokynů anesteziologa. Dostanete je písemně."],
      },
      {
        heading: "Co si vzít s sebou",
        items: [
          "občanský průkaz a kartičku pojišťovny",
          "léky, které berete, v původním balení",
          "zprávy od lékařů, které máte doma",
          "brýle, naslouchadlo nebo zubní náhradu i s pouzdrem",
          "pohodlné oblečení, přezůvky, nabíječku na telefon",
        ],
      },
      {
        heading: "Kdo se o vás postará",
        items: ["Operuje vás chirurg, o anestezii se stará anesteziolog a anesteziologická sestra.", "Na oddělení se o vás starají lékaři a sestry daného oddělení."],
      },
      {
        heading: "Po zákroku",
        items: [
          "Nejdřív se probudíte na dospávacím pokoji, pak jdete na oddělení.",
          "Po větších výkonech nebo podle vašeho zdraví můžete první dny strávit na JIP. Pokud to je u vás pravděpodobné, řekneme vám to dopředu.",
          "Návštěvy se řídí pravidly oddělení. Dozvíte se je při příjmu.",
        ],
      },
    ],
  },
  {
    id: "anestezie",
    title: "Jaké jsou možnosti anestezie",
    lead: "Kterou dostanete, rozhodne anesteziolog spolu s vámi podle výkonu a vašeho zdraví.",
    sections: [
      {
        heading: "Celková anestezie",
        items: ["Spíte a nic necítíte. Dýchání po celou dobu hlídá anesteziolog."],
      },
      {
        heading: "Svodná (regionální) anestezie",
        items: ["Znecitliví se jen část těla, třeba injekcí do zad nebo k nervu. Můžete být vzhůru, nebo dostanete lék na zklidnění."],
      },
      {
        heading: "Kombinace",
        items: ["Často se celková anestezie doplní znecitlivěním nervů. Po zákroku pak méně bolí."],
      },
      {
        heading: "Na co se zeptat",
        items: ["Rizika a co čekat po probuzení vám anesteziolog vysvětlí. Napište si otázky dopředu, nebo nám je pošlete hlasovou zprávou."],
      },
    ],
  },
];

export const ARTICLE_IDS = ARTICLES.map((a) => a.id);
export const CONSENT_VERSION = "ukazka-2026-10";

export const CONSENT = {
  title: "Souhlas s anestezií",
  note: "Ukázkové znění pro prototyp. Platný text dodá VFN. Podpis nenahrazuje rozhovor s anesteziologem, na schůzce ho s vámi projde.",
  points: [
    "Byl(a) jsem seznámen(a) s tím, jaké druhy anestezie připadají v úvahu a jak probíhají.",
    "Rozumím, že každá anestezie má rizika, a měl(a) jsem možnost se na ně zeptat.",
    "Údaje o svém zdraví, lécích a alergiích jsem uvedl(a) pravdivě.",
    "Souhlas mohu kdykoli odvolat.",
  ],
};
