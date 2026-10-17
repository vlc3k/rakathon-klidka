# braces 3.0.3 + oprava GHSA-vfj7-8cjw-p6xm

Lokální kopie [braces](https://github.com/micromatch/braces) 3.0.3 s jedinou změnou: parser odmítne vzor zanořený víc než 100 úrovní (`SyntaxError`). Bez toho vzor jako `{{{…a,b…}}}` s ~5000 úrovněmi (pod limitem 10 000 znaků) přetíží zásobník v rekurzivních průchodech AST a shodí proces ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high).

Proč kopie: upstream opravu nevydal, 3.0.3 je poslední verze. `braces` táhnou jen dev nástroje (`shadcn` CLI, `eslint-config-next`) přes `fast-glob` → `micromatch`. Next.js za běhu `braces` nepoužívá.

Napojení:

- `package.json` → `overrides.braces` ukazuje sem.
- `.npmrc` → `install-links=true`, aby npm složku nainstaloval jako běžný balíček i se závislostí `fill-range`. Bez toho vznikne symlink bez `fill-range` a `micromatch` spadne.
- npm má chybu: když `braces` znovu řeší z existujícího lockfilu, vezme cestu relativně k `node_modules/micromatch` a spadne na `ENOENT …/node_modules/micromatch/vendor/braces`. V lockfilu proto musí zůstat záznam `node_modules/braces` s `"resolved": "file:vendor/braces"`. Kdyby zmizel, vrať ho z gitu. Instalace bez lockfilu funguje.
- Verze `3.0.4-patched.0` leží nad zranitelným rozsahem `<=3.0.3`, takže `npm audit` tuhle kopii nehlásí. Jakmile advisory dostane opravenou verzi (např. `<3.0.4`), audit ji zase nahlásí a je čas přejít zpět na upstream.

Změna proti upstreamu: `lib/constants.js` (`MAX_DEPTH`) a `lib/parse.js` (`pushBlock`). Zbytek je beze změny.

Odstranění: až vyjde opravená verze braces, smaž `overrides.braces`, `.npmrc` a tuhle složku a spusť `npm install`.
