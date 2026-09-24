---
name: html-in-canvas
description: Technique de rendu de HTML dans un <canvas> (2D, WebGL ou WebGPU) via la proposition W3C/Chromium "HTML-in-Canvas" (attribut content="drawable", drawElementImage, evenement paint, synchronisation DOM<->canvas). A utiliser dès qu'un effet du projet dessine, deforme, ou compose du contenu HTML/DOM a l'interieur d'un canvas - meme si l'utilisateur dit juste "effet retro", "reflet ecran", "fissure", "courbure de page" ou "filtre" sans citer l'API explicitement. Couvre aussi la strategie de fallback obligatoire car l'API est experimentale et derriere un flag Chrome.
---

# HTML-in-Canvas

## Statut de l'API (important, à vérifier avant tout code)

Il s'agit d'une **proposition**, pas d'un standard stable. Implémentation
derrière un flag dans Chromium :
`chrome://flags/#canvas-draw-element` (+ souvent
`chrome://flags/#enable-experimental-web-platform-features` sur Chrome Canary).

**Conséquence directe pour le projet de fin de cours** : si le projet doit
être vu par un correcteur/un public sur un navigateur "normal", l'API risque
de ne pas être disponible. Toujours prévoir une **stratégie de repli** (voir
section Fallback) plutôt que de coder en dur sur l'hypothèse que l'API existe.

## Idée générale

Le problème que ça résout : dessiner du texte/layout HTML complexe dans un
`<canvas>` est aujourd'hui pénible (perte d'accessibilité, d'internationalisation,
de qualité). HTML-in-Canvas permet de garder des vrais éléments HTML dans le
DOM (donc stylables en CSS, accessibles) et de les faire **dessiner par le
canvas**, avec une synchronisation automatique DOM → canvas à chaque frame.

Concrètement : on écrit du HTML normal comme enfant d'un `<canvas>`, on le
marque comme "à dessiner", et un événement `paint` nous dit quand redessiner.

## Les primitives clés

### 1. `content="drawable"` sur le `<canvas>`

Sans ça, les enfants du canvas sont juste du contenu de fallback (comme
aujourd'hui). Avec `drawable`, les enfants sont mis en page (layout) mais pas
rendus automatiquement — c'est nous qui décidons quand/comment via JS.

### 2. Attribut `drawable` sur les éléments enfants

Marque un élément (et son sous-arbre) comme dessinable. Implique une
isolation CSS (`isolate`). Peut être imbriqué.

### 3. L'événement `paint`

Se déclenche à chaque mise à jour de rendu quand un élément `drawable` a
changé visuellement. C'est le point d'entrée pour redessiner le canvas.
`canvas.requestPaint()` force un déclenchement (utile pour boucles d'animation
continues, à la manière de `requestAnimationFrame`).

### 4. `drawElementImage(element, dx, dy, ...)`

Dessine le dernier "snapshot" d'un élément `drawable` dans le canvas 2D.
Équivalents pour WebGL (`texElementSubImage2D`) et WebGPU
(`drawElementImageToTexture`). Signature proche de `drawImage()` : accepte
des rectangles source/destination pour cropper ou repositionner/scaler.

### 5. Synchronisation retour canvas → DOM : `updateElementGeometry`

Permet de dire au DOM où l'élément a été dessiné dans le canvas (transform,
clip, ordre de hit-test). Appelé automatiquement par `drawElementImage` sauf
si on passe `{ preserveElementGeometry: true }`. Important pour que
l'accessibilité et le hit-testing restent cohérents avec ce qui est affiché.

## Exemple minimal (canvas 2D)

```html
<canvas id="c" content="drawable" style="width:400px;height:200px;">
  <form drawable>
    <label for="name">nom :</label>
    <input id="name" />
  </form>
</canvas>

<script>
  const canvas = document.querySelector("#c");
  const form = canvas.querySelector("form");
  const ctx = canvas.getContext("2d");

  canvas.onpaint = () => {
    ctx.reset();
    ctx.drawElementImage(form, 100, 0);
  };

  new ResizeObserver(([entry]) => {
    canvas.width = entry.contentRect.width * devicePixelRatio;
    canvas.height = entry.contentRect.height * devicePixelRatio;
  }).observe(canvas);
</script>
```

Le pattern à retenir : **on ne dessine jamais "à la main" dans une boucle
perso** pour du contenu DOM statique — on répond à `onpaint`, et on force un
repaint avec `requestPaint()` seulement si on anime nous-mêmes (ex. shader,
distorsion continue).

## Comment ça s'applique aux effets du projet

- **Rétro 2000 / courbure de page** : le HTML de la page (ou une portion)
  devient `drawable`, dessiné dans un canvas WebGL où un shader applique la
  distorsion/le filtre. `texElementSubImage2D` pour injecter le rendu HTML
  comme texture, puis shader classique.
- **Reflet lumière sur écran** : composition d'un calque HTML (le contenu) +
  un calque "reflet" généré par shader, mixés dans le même canvas.
- **Fissure d'écran / explosion** : le DOM entier (ou une capture) devient
  texture, découpée en fragments (mesh ou tiles) qui se déplacent
  indépendamment à l'écran — typiquement en WebGL/Three.js une fois qu'on a
  la texture via `drawElementImageToTexture`.
- **Loupe** : zoom localisé = `drawElementImage` avec un rectangle source
  petit et un rectangle destination plus grand (le zoom vient du ratio
  source/destination), pas besoin de shader pour l'effet de base.

## Pièges et limites à connaître

- **Sécurité / "read-back-allowed rendering"** : certaines infos ne sont
  jamais peintes ni ne déclenchent `paint` (contenu cross-origin, couleurs
  système, liens visités, anti-aliasing sous-pixel, autofill…). Si un effet
  a l'air "figé" sur ce type de contenu, c'est voulu, pas un bug.
- **Accessibilité** : un élément `drawable` dont la géométrie n'a jamais été
  mise à jour (pas encore dessiné) reste dans l'arbre d'accessibilité mais
  **sans info de géométrie**. Ne pas laisser de contenu `drawable` orphelin
  dans le DOM — le retirer ou `aria-hidden="true"` s'il n'est plus utilisé.
- **`drawElementImage` lève une exception** si l'élément n'a pas l'attribut
  `drawable`, n'a pas encore de snapshot, ou a un ancêtre canvas.
- **OffscreenCanvas / Worker** : pas d'accès DOM synchrone. On passe des
  `ElementImage` (via `captureElementImage`) au worker plutôt que l'élément
  lui-même ; les mises à jour de géométrie sont batchées par microtask et
  redescendent via `elementgeometryupdate` sur le thread principal.

## Références

- Explainer complet (spec proposée, IDL, démos) : voir le document source
  du projet / repo WICG correspondant.
- Démos officielles : texte complexe rotaté, pie chart avec labels,
  slider "jelly" en WebGPU, carte 3D en WebGL, éléments `drawable` imbriqués.
