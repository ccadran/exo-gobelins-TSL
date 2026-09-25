# html-in-canvas-project

Projet de fin de cours WebGL/TSL (Gobelins M2). Une suite linéaire de petites expériences
interactives qui testent l'API expérimentale **HTML-in-Canvas** : le DOM de chaque page est
copié dans une texture WebGPU puis transformé par des effets **three.js TSL**.

## Commandes

- `pnpm dev` : serveur de dev Vite
- `pnpm build` : typecheck (`tsc`) + build. À lancer pour vérifier le code (pas de tests).

## Navigateur requis

L'API n'existe que derrière des flags. Pas de fallback : c'est un choix assumé, ne pas en ajouter.

- Chrome (validé en 156) avec `chrome://flags/#canvas-draw-element` et
  `chrome://flags/#enable-experimental-web-platform-features` activés.
- Les flags peuvent disparaître ou expirer après une mise à jour de Chrome. Si
  `detectSupport()` renvoie tout à `false`, vérifier `chrome://flags` avant de toucher au code.
- L'API a changé de noms (WICG issue #174). Le projet utilise les **nouveaux** :
  `content="drawable"` + attribut `drawable`, `queue.drawElementImageToTexture`,
  `canvas.updateElementGeometry`. Pas les anciens (`layoutsubtree`, `copyElementImageToTexture`).
- Le skill `html-in-canvas` (`.claude/skills/`) résume l'API. Le skill `webgpu-threejs-tsl`
  couvre TSL.

## Stack

Vite + TypeScript + `three` (import depuis `three/webgpu` et `three/tsl`, `WebGPURenderer`
uniquement) + Tweakpane 4 pour le debug.

## Architecture

```
src/
  main.ts               → new App(canvas, { nom: () => new Page() }) — ordre = parcours,
                          noms = boutons du dossier debug "pages" (navigation directe)
  core/
    App.ts              → renderer, resize, boucle pilotée par `paint`, AppContext, bouton Suivant
    PageManager.ts      → page courante / entrante, lance la transition, affiche le résultat
    ElementRegion.ts    → suit un élément du DOM et l'expose au shader (SDF en pixels CSS)
    HtmlTexture.ts      → pont DOM -> texture three
    Pointer.ts          → uniform TSL du pointeur (repère screenUV)
    support.ts          → détection de l'API
    html-in-canvas.d.ts → types de l'API absents de lib.dom
  pages/
    Page.ts             → classe de base d'une page
    <page>/index.ts     → la page (setup TSL, update, draw)
    <page>/template.html  (importé en ?raw)
    <page>/style.css      (importé en ?inline, scopé sous [data-page="<id>"])
  tsl/utils.ts          → helpers TSL partagés (hash, SDF, rotation, colorUniform, types Vec2/Vec3)
  transitions/
    Transition.ts       → interface : steps, start({ from, to, origin }), hit, update, render, done
    circle/             → transition simple (cercle qui s'élargit depuis le bouton), 1 clic
    crack/              → vitre brisée en plusieurs clics (Voronoi + éclats 3D + verre TSL)
```

### Principes à respecter

- **Un seul canvas, un seul `WebGPURenderer`.** Le DOM de chaque page est une
  `<section drawable class="page" data-page="…">` enfant du `<canvas content="drawable">`.
  Il n'est jamais affiché directement : la page le dessine via sa texture.
- **La boucle est pilotée par l'événement `paint`**, pas par `requestAnimationFrame` ni
  `setAnimationLoop`. À chaque `paint` : `HtmlTexture.sync()` copie le DOM, puis
  `page.update()` et `page.render()`, puis `canvas.requestPaint()` pour la frame suivante.
  C'est ce qui évite une frame de retard entre le DOM et la texture.
- **`HtmlTexture`** crée sa `GPUTexture` avec `renderer.backend.device` et la passe à three
  via `ExternalTexture`. Au resize, on change `sourceTexture` après un `dispose()` : l'objet
  `html.texture` reste le même, donc les matériaux n'ont rien à refaire. Dans un matériau :
  `texture(this.html.texture, uv)`. Couleurs : texture `rgba8unorm` + `SRGBColorSpace`, décodée
  dans le shader.
- **Repère UV** : `screenUV` (origine en haut à gauche) correspond directement aux UV de la
  texture HTML pour une page plein écran. `Pointer.uv` est dans le même repère.
- **Contrat d'une page** (`Page.ts`) : `mount()` (injecte DOM + CSS, crée `this.html` et un
  dossier Tweakpane `this.debug`, appelle `setup(ctx)`), `update(delta, elapsed)`,
  `draw(renderer)` (appelé par `render()` avec la cible déjà réglée sur `this.output`),
  `leave()` (rend le DOM `inert`), `dispose()` (doit tout retirer : DOM, style, texture,
  matériaux). Un élément `drawable` orphelin laissé dans le DOM pollue l'accessibilité.
- **Chaque page rend dans son `output`** (RenderTarget HalfFloat à la taille du drawing buffer),
  jamais directement à l'écran. Le `PageManager` affiche `output`, ou la transition.
- **Bouton Suivant** : créé par `Page.mount()` dans le DOM de chaque page (`page.nextButton`,
  stylé dans `index.html`), donc dessiné et cassé avec la page. Le `PageManager` écoute ses
  clics et change son texte (Suivant → Encore → Allez).
- **Transitions** : elles ne reçoivent que deux textures et une origine (screenUV), jamais les
  pages. 1er clic : le `PageManager` monte la page suivante, appelle `start()` puis `hit()` ;
  clics suivants : `hit()`. Au `steps`-ième clic la page sortante devient `inert`, et elle est
  disposée quand `done` passe à vrai.
- **Piège TSL** : `textureNode.sample(uv)` clone le nœud et fige sa texture. Si on doit changer
  la texture après coup (`node.value = …`), créer le nœud avec `texture(tex, uv)` et utiliser
  ce nœud-là directement dans le graphe.
- **Cibler un élément du DOM dans un shader** : `new ElementRegion(el)`, `region.update()` à
  chaque frame, puis `region.sdf(screenUV * viewport)` (viewport = taille CSS de la fenêtre).
- **Typage TSL** : `Node` s'importe depuis `three/webgpu`. Typer les paramètres des helpers en
  `Node<"vec2">` / `Node<"float">` (types `Vec2`, `Vec3` de `tsl/utils`). Les uniforms de couleur
  passent par `colorUniform("#hex")` (sinon typés "color", incompatibles avec vec3). Pour
  `uniformArray`, passer le type `as const` (ex. `"vec4" as const`).
- **Performance des shaders** : les pages sont calculées en plein écran, en Retina, à chaque
  frame. Un effet qui peut être éteint doit être dans un `If(uniform…)` à l'intérieur d'un
  `Fn` (vrai branchement : éteint = gratuit), pas dans un `select`/`mix` qui calcule les deux
  côtés. Éviter de réévaluer plusieurs fois un bruit fractal (ex. pentes par différences
  finies) : limiter ce calcul aux zones où il est visible. Un addon coûteux (ex. `BloomNode`)
  tourne même à force 0 : prévoir un matériau sans lui. L'App limite les fps (60 par défaut)
  et expose la résolution dans le debug (dossier "Performance").
- **Debug** : chaque page range ses réglages dans `this.debug` (dossiers par effet, vues de
  debug via un uniform `viewMode` + `select`). Les uniforms sont bindés directement
  (`addBinding(u, "value", …)`).
- `src/pages/spike/` est la page de validation de la chaîne DOM -> TSL, et `test-a` / `test-b`
  les pages de test du PageManager. À garder comme références tant qu'elles servent.

## Conventions de code

- `tsconfig` a `erasableSyntaxOnly` : **pas de propriétés déclarées dans le constructeur**
  (`constructor(private x)`), ni d'`enum` ni de `namespace`. Déclarer les champs puis les assigner.
- `noUnusedLocals` / `noUnusedParameters` : préfixer par `_` les paramètres inutilisés.
- Commentaires et textes de l'interface en français.
- Les internes de three (`renderer.backend…`) sont isolés dans `core/`, jamais dans les pages.

## Règles de travail

- **Les effets se font en TSL.** Avant d'utiliser autre chose (canvas 2D, WGSL brut, une
  librairie non-TSL…), demander confirmation.
- Ne pas anticiper les sujets reportés (voir plus bas) : on les traitera au moment venu.

## Parcours prévu

Suite linéaire : expérience → transition → expérience suivante. Chaque expérience est une page
indépendante (DOM, style et effets propres).

1. **Eau ou feu** : selon la réponse, des parties de la page brûlent, ou des gouttes tombent
   devant la page.
2. **Années 2000** : un curseur ; plus on va à droite, plus les effets s'accumulent (courbure
   de la page, filtre rétro…).
3. **Loupe** : texte minuscule + checkbox « Tu me vois ? » ; une icône loupe en haut à droite
   active une loupe.
4. **Textarea à effacer** : chaque lettre effacée tombe en bas de la page avec de la physique.
5. **Allumer la lumière** : reproduire le reflet d'une lumière sur un écran.

**Transition « fissure »** (commune à toutes les pages) : un bouton « Suivant » est toujours
affiché. Chaque tap dessus fissure un peu plus la page ; au dernier tap, la page explose en
éclats et révèle la suivante. Il faut donc qu'une transition puisse disposer de la texture de
la page sortante et de celle de la page entrante (le rendu des pages dans des render targets et
un PageManager restent à construire).

## Sujets reportés (ne pas traiter sans demande)

- **Clics sur du HTML déformé** : le hit-testing suit la position réelle du DOM, pas l'image
  déformée (loupe, courbure, ondulation). Écarts acceptés pour l'instant.
- **Physique des lettres** (textarea) : choix de la méthode à décider plus tard.
