/**
 * Static self-check for dsh-adaptive-shell.
 *
 * It runs the Client half for real — inside a `node:vm` context with a minimal
 * `window`/`document`/`MutationObserver`/`matchMedia` surface — so the loader
 * declaration, the module body, the slot registrations and the stylesheet are all
 * exercised rather than pattern-matched. It does NOT emulate a browser: no
 * rendering, no layout, no visual claim.
 *
 * What it proves is narrower and more useful than "the CSS looks tidy": that this
 * plugin **cannot** produce the failure it once shipped. v1 added a full-frame
 * click-catching overlay, put the only close button underneath it, and left the
 * user in a state where the conversation could neither be tapped nor scrolled and
 * only a reload escaped. The audits below are the encoding of that lesson:
 *
 *  - the plugin renders no overlay at all, and mentions neither `pointer-events`
 *    nor any positioning property anywhere in its stylesheet;
 *  - it never references the frame's structural markers, so the grid, the
 *    stacking order and the scroll containers stay the shell's own;
 *  - it occupies exactly one slot — the additive settings list — and no seat that
 *    renders into the frame;
 *  - it never touches the document height.
 *
 * Run: node test/smoke.mjs
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const failures = [];
const passes = [];

function check(label, condition, detail) {
	if (condition) {
		passes.push(label);
		return;
	}
	failures.push(label + (detail === undefined || detail === "" ? "" : " — " + detail));
}

function report() {
	for (const line of passes) console.log("  ok   " + line);
	for (const line of failures) console.log("  FAIL " + line);
	console.log("");
	console.log(passes.length + " passed, " + failures.length + " failed");
	if (failures.length > 0) process.exit(1);
}

//#region 1. package surface

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
check("package.json: name", pkg.name === "dsh-adaptive-shell", pkg.name);
check("package.json: type module", pkg.type === "module");
check("package.json: client export", pkg.exports?.["./client"]?.default === "./client.js");
check("package.json: bundle patch declared", pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
check("package.json: client platform is web", pkg.dsh?.client?.platform === "web");
check("package.json: client loads immediately", pkg.dsh?.client?.immediately === true);
check(
	"package.json: client inject order declared",
	Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-layout"),
);

for (const file of ["index.js", "client.js", "cordis.patch.yml", "README.md"]) {
	check("file exists: " + file, fs.existsSync(path.join(ROOT, file)));
}

const patch = fs.readFileSync(path.join(ROOT, "cordis.patch.yml"), "utf8");
check("patch: inserts the row", /insert:/.test(patch) && /id:\s*adaptive-shell/.test(patch) && /name:\s*dsh-adaptive-shell/.test(patch));

const hostHalf = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
check("index.js: exports apply", /export function apply\s*\(/.test(hostHalf));

//#endregion

//#region 2. load the Client half for real

const source = fs.readFileSync(path.join(ROOT, "client.js"), "utf8");
check("client.js: single loader declaration", (source.match(/__ModuleLoader__\.load\(/g) || []).length === 1);
check("client.js: loader id", /id:\s*"dsh-adaptive-shell"/.test(source));
check("client.js: imports no Harness Client package", !/require\(\s*["']@deepseek-ai\//.test(source));
check("client.js: no jsx runtime dependency", !/require\(\s*["']react\/jsx-runtime["']/.test(source));

const React = {
	// The counter exists to catch hooks-order violations: the same component must call
	// the same number of hooks in every state. Rendering it in both drawer states and
	// comparing the counts is what a "vanished button" defect looks like from outside.
	__hooks: 0,
	createElement: (type, props, ...children) => ({ type, props, children }),
	useState: (initial) => {
		React.__hooks += 1;
		return [typeof initial === "function" ? initial() : initial, () => {}];
	},
	useEffect: () => {
		React.__hooks += 1;
	},
	useRef: (initial) => ({ current: initial }),
};

/** Build a contextified sandbox that captures the loader definition. */
function loadClient(extraGlobals) {
	const captured = { definition: null };
	const globals = {
		console,
		Symbol,
		Object,
		JSON,
		Math,
		Boolean,
		String,
		Number,
		Array,
		Set,
		Map,
		Date,
		Error,
		RegExp,
		Promise,
		URL,
		...(extraGlobals || {}),
	};
	globals.window = { ...(globals.window || {}), __ModuleLoader__: { load(def) { captured.definition = def; } } };
	globals.globalThis = globals;
	const context = vm.createContext(globals);
	vm.runInContext(source, context, { filename: "client.js" });
	const exportsObject =
		captured.definition === null
			? null
			: captured.definition.factory((id) => {
					if (id === "react") return React;
					throw new Error("unexpected require: " + id);
				});
	return { definition: captured.definition, exports: exportsObject, globals };
}

const loaded = loadClient();
check("client.js: registered a loader definition", loaded.definition !== null);
check("client.js: factory is a function", typeof loaded.definition?.factory === "function");

const moduleExports = loaded.exports;
check("exports: name", moduleExports?.name === "adaptive-shell", String(moduleExports?.name));
check("exports: apply", typeof moduleExports?.apply === "function");
check(
	"exports: inject declares the services it uses",
	Array.isArray(moduleExports?.inject) && ["slots", "locale", "theme"].every((key) => moduleExports.inject.includes(key)),
	JSON.stringify(moduleExports?.inject),
);
check("exports: stylesheet exposed for audit", Array.isArray(moduleExports?.__css) && moduleExports.__css.length > 0);
check("exports: classifier exposed for audit", typeof moduleExports?.__classify === "function");

//#endregion

//#region 3. classifier boundaries

const classify = moduleExports.__classify;
const cases = [
	[390, 844, "auto", "phone", "portrait"],
	[320, 568, "auto", "phone", "portrait"],
	[600, 900, "auto", "phone", "portrait"],
	[844, 390, "auto", "phone", "landscape"],
	[768, 1024, "auto", "tablet", "portrait"],
	[1024, 768, "auto", "tablet", "landscape"],
	[1280, 800, "auto", "desktop", "landscape"],
	[1280, 470, "auto", "desktop", "landscape"],
	[1920, 1080, "auto", "desktop", "landscape"],
	[390, 844, "desktop", "desktop", "portrait"],
	[1920, 1080, "phone", "phone", "landscape"],
];
for (const [w, h, override, form, orient] of cases) {
	const got = classify(w, h, override);
	check(
		"classify(" + w + "x" + h + ", " + override + ") -> " + form + "/" + orient,
		got.form === form && got.orient === orient,
		got.form + "/" + got.orient,
	);
}
check("classify: short viewport is compact", classify(390, 390, "auto").density === "compact");
check("classify: tall viewport is comfortable", classify(390, 844, "auto").density === "comfortable");

//#endregion

//#region 4. locale parity

const dicts = moduleExports.__dicts;
const zhKeys = Object.keys(dicts.zh).sort();
const enKeys = Object.keys(dicts.en).sort();
check("locale: dictionaries carry the same keys", zhKeys.join("|") === enKeys.join("|"), zhKeys.filter((key) => !enKeys.includes(key)).join(", "));
const literalKeys = [...new Set([...source.matchAll(/\bt\("([a-zA-Z][a-zA-Z0-9_.]*)"\)/g)].map((match) => match[1]))];
const missingKeys = literalKeys.filter((key) => !(key in dicts.zh) || !(key in dicts.en));
check("locale: every literal key exists in both dictionaries", missingKeys.length === 0, missingKeys.join(", "));
// The readout composes these from state, so they are not literal `t("…")` calls.
const composedKeys = ["readout.phone", "readout.tablet", "readout.desktop", "readout.narrow", "readout.wide", "readout.sidebarOpen", "readout.sidebarClosed", "readout.touchOn", "readout.touchOff", "readout.theme", "readout.unknown"];
check("locale: composed readout keys exist", composedKeys.every((key) => key in dicts.zh && key in dicts.en), composedKeys.filter((key) => !(key in dicts.zh)).join(", "));

//#endregion

//#region 5. Miracle palette

const tokens = moduleExports.__tokens;
const lum = (hex) => {
	const value = hex.replace("#", "");
	return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).reduce((sum, channel) => sum + channel, 0) / 3;
};
check("miracle: every token is a { light, dark } pair", Object.values(tokens).every((pair) => typeof pair?.light === "string" && typeof pair?.dark === "string"));
check("miracle: dark ground is not pure black", !/#000000|#000\b|black/i.test(tokens["--dsw-alias-bg-base"].dark), tokens["--dsw-alias-bg-base"].dark);
check("miracle: light ground is not pure white", !/#ffffff|#fff\b|white/i.test(tokens["--dsw-alias-bg-base"].light), tokens["--dsw-alias-bg-base"].light);
check("miracle: dark shadows collapse to none", tokens["--dsw-shadow-lv1"].dark === "none" && tokens["--dsw-shadow-lv2"].dark === "none");
check(
	"miracle: dark mode brightens the brand instead of darkening it",
	lum(tokens["--dsw-alias-brand-primary"].dark) > lum(tokens["--dsw-alias-brand-primary"].light) * 1.15,
	tokens["--dsw-alias-brand-primary"].light + " -> " + tokens["--dsw-alias-brand-primary"].dark,
);
check(
	"miracle: the raised surface is lighter than the page in dark",
	lum(tokens["--dsw-alias-bg-layer-1"].dark) > lum(tokens["--dsw-alias-bg-base"].dark),
);

//#endregion

//#region 6. stylesheet audit

const CSS_ENTRIES = moduleExports.__css;
const cssText = CSS_ENTRIES.join("\n");

/** Split one entry into its at-rule wrapper (if any) and its single inner rule. */
function unwrap(entry) {
	let rule = entry;
	let wrapper = null;
	while (rule.startsWith("@")) {
		const brace = rule.indexOf("{");
		wrapper = rule.slice(0, brace).trim();
		rule = rule.slice(brace + 1).replace(/\}\s*$/, "");
	}
	const brace = rule.indexOf("{");
	return { wrapper, selector: rule.slice(0, brace).trim(), body: rule.slice(brace + 1, rule.lastIndexOf("}")) };
}

const parsed = CSS_ENTRIES.map(unwrap);
const POINTER_GATE = '@media (hover: hover) and (pointer: fine)';
const AT_RULE_WRAPPERS = [POINTER_GATE, "@media (prefers-reduced-motion: reduce)", "@supports (interpolate-size: allow-keywords)", "@keyframes dshas-unfold"];
const styleRules = parsed.filter((rule) => !(rule.wrapper !== null && rule.wrapper.startsWith("@keyframes")));
const isKeyframes = (rule) => rule.wrapper !== null && rule.wrapper.startsWith("@keyframes");

check("css: no CSS-module hash class name", !/\.[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]*/.test(cssText));

const hex = cssText.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
check("css: no hex colour literal", hex.length === 0, hex.join(", "));

const colourFns = cssText.match(/\b(?:rgba?|hsla?)\([^)]*\)/g) || [];
check("css: no literal colour at all", colourFns.length === 0, colourFns.join(", "));

// --- the failure class: nothing may cover, capture or reposition ------------
// Declarations are read as real property names, ignoring custom properties:
// `--dsh-composer-dock-inset` contains the substring "inset:" but declares
// nothing about positioning, and a substring scan would both miss real defects
// and invent fake ones.
function declarations(body) {
	return body
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => {
			const colon = part.indexOf(":");
			return { prop: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() };
		});
}

const everyDeclaration = [];
for (const rule of styleRules) for (const declaration of declarations(rule.body)) everyDeclaration.push({ rule: rule.selector, ...declaration });

const LAYOUT_FORBIDDEN = ["pointer-events", "overflow-x", "overflow-y", "filter", "perspective", "contain", "backdrop-filter", "container-type", "float"];
// One exception: the settings section strip scrolls HORIZONTALLY on a phone. Its vertical
// overflow stays `hidden`, so a vertical gesture is never handled there and keeps propagating
// to the modal's own scroller — the capture hazard this rule exists to prevent.
const SETTINGS_STRIP = 'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > nav';
const SETTINGS_CONTENT = 'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child';
const SETTINGS_STRIP_LIST = SETTINGS_STRIP + " > :last-child";
const SETTINGS_CLOSE = 'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :first-child > :last-child';
const SETTINGS_STRUCTURE = [
	'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"]',
	SETTINGS_STRIP,
	SETTINGS_STRIP + " > :first-child",
	SETTINGS_STRIP_LIST,
	SETTINGS_STRIP + " button",
	SETTINGS_CONTENT,
	'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :first-child',
	'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :first-child > :last-child',
	'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :last-child',
];
const layoutViolations = everyDeclaration.filter(
	(declaration) =>
		(LAYOUT_FORBIDDEN.includes(declaration.prop) || declaration.prop.startsWith("overflow-")) &&
		!([SETTINGS_STRIP, SETTINGS_STRIP_LIST].includes(declaration.rule) && (declaration.prop === "overflow-x" || declaration.prop === "overflow-y")),
);
check(
	"css: no declaration can capture or repaint a shipped surface",
	layoutViolations.length === 0,
	layoutViolations.map((declaration) => declaration.rule + " { " + declaration.prop + " }").join(" | "),
);

const heightDeclarations = everyDeclaration.filter((declaration) => /^(min-|max-)?height$/.test(declaration.prop));
const viewportHeight = heightDeclarations.filter((declaration) => /(\d+)(d|s|l)?vh/.test(declaration.value));
check(
	"css: no viewport-height declaration (a resizing container loses touch scrolls)",
	viewportHeight.length === 0,
	viewportHeight.map((declaration) => declaration.rule + " { " + declaration.prop + ": " + declaration.value + " }").join(" | "),
);
const OWN_MARK_LIST = ["data-dsh-adaptive-row", "data-dsh-adaptive-select", "data-dsh-adaptive-switch", "data-dsh-adaptive-readout", "data-dsh-adaptive-nav"];
// Only FIXED pixel heights are forbidden on shipped surfaces; a percentage inside the fixed
// overlay is how the settings panel becomes full-bleed without introducing a viewport unit.
const exactHeights = heightDeclarations.filter(
	(declaration) => declaration.prop === "height" && /\d+px/.test(declaration.value) && declaration.rule !== SETTINGS_STRIP + " button" && declaration.rule !== SETTINGS_CLOSE,
);
const minHeights = heightDeclarations.filter((declaration) => declaration.prop === "min-height");
check(
	"css: an exact height is only ever set on this plugin's own controls",
	exactHeights.every((declaration) => OWN_MARK_LIST.some((mark) => declaration.rule.includes(mark))),
	exactHeights.map((declaration) => declaration.rule + " { height: " + declaration.value + " }").join(" | "),
);
check(
	"css: min-height is only ever relaxed to 0 or raised to a touch target",
	minHeights.every((declaration) => declaration.value === "0" || /^(3[2-9]|4[0-9])px$/.test(declaration.value)),
	minHeights.map((declaration) => declaration.prop + ":" + declaration.value).join(" | "),
);

// --- the frame: a pinned allowlist of structural rules ----------------------
// v2 removed every structural rule; later revisions brought back a deliberately
// minimal, enumerated set so a narrow phone can drop the empty 56px rail, open the
// sidebar as an overlay that does NOT reflow the conversation, and move both of them
// on one compositor timeline. Every one of them is listed here by its exact suffix:
// anything else touching the frame fails the build.
const GATE = 'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"]';
const F = " :has(> [data-shell-overlay])";
const TRACK = GATE + F;
const SUPPRESS = GATE + F + " > :first-child > *";
const HANDLES = GATE + F + " > [data-side]";
const SHELL_TOGGLE = GATE + F + " > :first-child [data-window-drag] > button:last-child";
const RAIL_PARKED = GATE + F + "[data-sidebar-collapsed] > :first-child";
const CONVO_REST = GATE + F + "[data-sidebar-collapsed] > :nth-child(2)";
const BOX = GATE + F + " > :first-child";
const DRAWER = GATE + F + ":not([data-sidebar-collapsed]) > :first-child";
const CONVO_PUSHED = GATE + F + ":not([data-sidebar-collapsed]) > :nth-child(2)";
const PUSH_GATE = GATE.replace('html[', 'html[data-dsh-adaptive-push="1"][');
const ALLOWED_SUFFIXES = [
	F + " > :first-child",
	F + " > :nth-child(2)",
	F + "[data-sidebar-collapsed] > :nth-child(2)",
	F + ":not([data-sidebar-collapsed]) > :nth-child(2)",
	F,
	F + " > :first-child > *",
	F + " > [data-side]",
	F + " > :first-child [data-window-drag] > button:last-child",
	F + "[data-sidebar-collapsed] > :first-child",
	F + "[data-sidebar-collapsed] > :nth-child(2)",
	F + ":not([data-sidebar-collapsed]) > :first-child",
	F + ":not([data-sidebar-collapsed]) > :nth-child(2)",
];

const FORMER_FORBIDDEN_MARKS = ["data-rightbar-col", "data-shell-leading"];
const forbiddenFrameMarks = FORMER_FORBIDDEN_MARKS.filter((mark) => cssText.includes(mark));
check("css: never references a frame marker outside the allowlist", forbiddenFrameMarks.length === 0, forbiddenFrameMarks.join(", "));

const structuralRules = parsed.filter((rule) => /data-shell-overlay|data-sidebar-collapsed|\[data-side\]/.test(rule.selector));
const illegalStructure = [];
for (const rule of structuralRules) {
	for (const part of rule.selector.split(",")) {
		const selector = part.trim();
		const bare = selector.startsWith(PUSH_GATE) ? selector.slice(PUSH_GATE.length) : selector.startsWith(GATE) ? selector.slice(GATE.length) : null;
		if (bare !== null && ALLOWED_SUFFIXES.includes(bare)) continue;
		illegalStructure.push(selector);
	}
}
check(
	"css: every structural rule is on the pinned allowlist (and narrow+phone gated)",
	structuralRules.length === 10 && illegalStructure.length === 0,
	illegalStructure.join(" | ") || structuralRules.map((rule) => rule.selector).join(" | "),
);

const POSITION_PROPS = ["position", "inset", "top", "right", "bottom", "left", "z-index"];
const positioning = everyDeclaration.filter((declaration) => POSITION_PROPS.includes(declaration.prop));
// Two rules may position: the drawer's box (the layout this plugin owns) and the settings
// dialog's close control (a leaf button lifted to the sheet's corner, see SETTINGS_CLOSE).
// Everything else must stay in flow.
const positioningAllowed = (rule) => rule === BOX || rule === SETTINGS_CLOSE;
check(
	"css: positioning exists only in the drawer's box and the settings close control",
	positioning.length > 0 && positioning.every((declaration) => positioningAllowed(declaration.rule)),
	positioning.filter((declaration) => !positioningAllowed(declaration.rule)).map((declaration) => declaration.rule + " { " + declaration.prop + " }").join(" | "),
);
// The box must be identical in both states, so flipping the state changes the transform
// and nothing else. A box that differs between the states settles after the slide, which
// is exactly the "it arrives and then corrects itself" the user sees.
const stateRules = parsed.filter((rule) => rule.selector === DRAWER || rule.selector === RAIL_PARKED);
const boxPropsInStateRules = [];
for (const rule of stateRules) for (const declaration of declarations(rule.body)) {
	if (["position", "z-index", "width", "max-width", "box-shadow", "will-change"].includes(declaration.prop)) boxPropsInStateRules.push(rule.selector + " { " + declaration.prop + " }");
}
check(
	"motion: the two state rules carry no box property at all (only transform + visibility + transition)",
	boxPropsInStateRules.length === 0,
	boxPropsInStateRules.join(" | "),
);
check(
	"css: the drawer width comes from one named token, not a literal",
	(() => {
		const box = parsed.find((rule) => rule.selector === BOX);
		return box !== undefined && /(^|;)\s*width\s*:\s*var\(--dshas-drawer\)/.test(box.body) && cssText.includes("--dshas-drawer:min(280px, 100vw)");
	})(),
);

// The bug that blanked the conversation: taking the sidebar column out of the grid
// flow shifts auto-placement, so the centre column becomes the first in-flow item and
// lands in track 1 — the zeroed one — and the transcript collapses to 0 wide. A frame
// child may therefore only ever be `position:relative`.
const positionDeclarations = everyDeclaration.filter((declaration) => declaration.prop === "position");
// Two rules may position anything. The frame child may only ever be `relative` (the bug that
// blanked the conversation was taking it out of the grid flow). The one `absolute` is the
// settings dialog's 28px close control, a leaf button inside a `position:relative` panel whose
// space the section strip already reserves — it cannot move any flow and cannot cover content.
const frameChildPositions = positionDeclarations.filter((declaration) => declaration.rule.includes("[data-shell-overlay]"));
check(
	"css: a frame child is only ever position:relative (out of flow = centre lands in the zero track)",
	frameChildPositions.length > 0 && frameChildPositions.every((declaration) => declaration.value === "relative"),
	frameChildPositions.map((declaration) => declaration.rule + " { position: " + declaration.value + " }").join(" | "),
);
check(
	"css: the only out-of-flow element is that one leaf close control, and it pins to the corner only",
	positionDeclarations.filter((declaration) => declaration.value !== "relative").length === 1 &&
		positionDeclarations.some((declaration) => declaration.rule === SETTINGS_CLOSE && declaration.value === "absolute") &&
		parsed.filter((rule) => rule.selector === SETTINGS_CLOSE).every((rule) => declarations(rule.body).every((declaration) => ["position", "top", "right", "width", "height", "justify-content"].includes(declaration.prop))),
	positionDeclarations.map((declaration) => declaration.rule + " { position: " + declaration.value + " }").join(" | "),
);
check("css: the frame override keeps three tracks, so the centre stays in track 2", cssText.includes("grid-template-columns:0 minmax(0,1fr) 0 !important"));

const drawerRule = parsed.find((rule) => rule.selector === DRAWER);
check("css: the drawer is positioned by left/top/bottom only", drawerRule !== undefined && !/(^|;)\s*(right|inset)\s*:/.test(drawerRule.body), drawerRule === undefined ? "missing" : drawerRule.body);


const zIndexValues = everyDeclaration.filter((declaration) => declaration.prop === "z-index").map((declaration) => Number(declaration.value));
check("css: the drawer's stacking stays below the effort card (1100)", zIndexValues.every((value) => value < 1100), zIndexValues.join(", "));

const importantRules = parsed.filter((rule) => rule.body.includes("!important"));
check(
	"css: exactly one rule needs !important, and it is the rail track",
	importantRules.length === 1 && importantRules[0].selector === TRACK,
	importantRules.map((rule) => rule.selector).join(" | "),
);

// --- the composer's containing block is never disturbed --------------------
const FORBIDDEN = ["transform:", "filter:", "perspective:", "contain:", "backdrop-filter:", "will-change:", "container-type:", "overflow:"];
const SHIPPED_TARGETS = ["data-composer-card", "data-conversation-header-leading", "data-sidebar-right-panel"];
let containingBlockViolation = null;
for (const rule of parsed) {
	if (!SHIPPED_TARGETS.some((mark) => rule.selector.includes(mark))) continue;
	// `transform` is intentional on the entry-motion rules. The one that could matter is the
	// right-hand sheet, and it carries a transform only while it is CLOSED — when no fixed
	// overlay inside it can be open — so it never becomes a containing block in use.
	const ENTRY_TRANSFORM_OK = ["[data-disclosure-row]", "[data-dockkit-float]", '[aria-modal="true"]', '[role="dialog"]', "[data-sidebar-right-panel]:not([data-sidebar-right-open])"];
	const hit = FORBIDDEN.find((property) => rule.body.includes(property) && !(property === "transform:" && ENTRY_TRANSFORM_OK.some((mark) => rule.selector.includes(mark))));
	if (hit !== undefined) containingBlockViolation = rule.selector + " uses " + hit;
}
check(
	"css: shipped surfaces never get a containing-block/paint-creating property",
	containingBlockViolation === null,
	containingBlockViolation || "",
);

// --- gates ------------------------------------------------------------------
const OWN_MARKS = ["data-dsh-adaptive-row", "data-dsh-adaptive-select", "data-dsh-adaptive-switch", "data-dsh-adaptive-readout", "data-dsh-adaptive-nav"];
const GATES = ["data-dsh-adaptive-form=", "data-dsh-adaptive-narrow=", "data-dsh-adaptive-density=", "data-dsh-adaptive-touch=", "data-dsh-adaptive-compat=", "data-dsh-adaptive-miracle=", "data-dsh-adaptive-motion=", "data-dsh-adaptive-wideReading="];
const ungated = [];
for (const rule of styleRules) {
	// A rule that only defines private custom properties restyles nothing: it is the
	// motion scale, which has to exist before any gated rule can reference it.
	const body = rule.body.split(";").map((part) => part.trim()).filter((part) => part.length > 0);
	if (body.length > 0 && body.every((part) => part.startsWith("--dshas-"))) continue;
	for (const selector of rule.selector.split(",").map((value) => value.trim())) {
		if (OWN_MARKS.some((mark) => selector.includes(mark))) continue;
		if (GATES.some((gate) => selector.includes(gate))) continue;
		// A rule inside a pointer-capability media query is gated by that query, not by an attribute:
		// it can only ever apply to a device with a real pointer.
		if (rule.wrapper !== null && rule.wrapper.startsWith(POINTER_GATE)) continue;
		ungated.push(selector);
	}
}
check("css: shipped elements are only ever restyled behind a gate", ungated.length === 0, ungated.join(" | "));

const badSelectors = [];
for (const rule of styleRules) {
	for (const selector of rule.selector.split(",")) {
		if (!selector.trim().startsWith("html[data-dsh-adaptive")) badSelectors.push(selector.trim());
	}
}
check("css: every selector starts with the html gate", badSelectors.length === 0, badSelectors.join(" | "));

//#endregion

// --- invariants that were described but never actually asserted -------------
// These four were silently dropped by a failed patch anchor and the suite still went
// green, which is the worst possible state for an audit. They are pinned here.
const visibilityNow = everyDeclaration.filter((declaration) => declaration.prop === "visibility");
check(
	"css: visibility is only ever hidden, and only on the parked rail",
	visibilityNow.length === 1 && visibilityNow[0].value === "hidden" && visibilityNow[0].rule === RAIL_PARKED,
	visibilityNow.map((declaration) => declaration.rule + " { " + declaration.value + " }").join(" | "),
);
const willChangeNow = everyDeclaration.filter((declaration) => declaration.prop === "will-change");
check(
	"css: will-change:transform exists only on the sidebar column",
	willChangeNow.length === 1 && willChangeNow[0].rule === BOX && willChangeNow[0].value === "transform",
	willChangeNow.map((declaration) => declaration.rule + " { " + declaration.value + " }").join(" | "),
);
const touchActionNow = everyDeclaration.filter((declaration) => declaration.prop === "touch-action");
check(
	"css: touch-action is only ever manipulation, never none",
	touchActionNow.length > 0 && touchActionNow.every((declaration) => declaration.value === "manipulation"),
	touchActionNow.map((declaration) => declaration.rule + " { " + declaration.value + " }").join(" | "),
);
const overflowNow = everyDeclaration.filter((declaration) => declaration.prop === "overflow");
check(
	"css: overflow is only ever hidden, and only as the unfold's clipping",
	overflowNow.length === 1 && overflowNow[0].value === "hidden" && overflowNow[0].rule.includes("[data-disclosure-row]"),
	overflowNow.map((declaration) => declaration.rule + " { " + declaration.value + " }").join(" | "),
);

//#region 7. token existence

const referenced = [...new Set([...cssText.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))];
const shippedDir = "/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
let definedTokens = null;
try {
	definedTokens = new Set();
	for (const entry of fs.readdirSync(shippedDir)) {
		const libDir = path.join(shippedDir, entry, "lib");
		if (!fs.existsSync(libDir)) continue;
		for (const file of fs.readdirSync(libDir)) {
			if (!file.endsWith(".js")) continue;
			const text = fs.readFileSync(path.join(libDir, file), "utf8");
			for (const match of text.matchAll(/(--(?:dsw|ds)-[a-z0-9-]+)\s*:/g)) definedTokens.add(match[1]);
		}
	}
	if (definedTokens.size === 0) definedTokens = null;
} catch (error) {
	definedTokens = null;
}
if (definedTokens === null) {
	check(
		"css: referenced tokens exist (shipped bundles unavailable, prefix check only)",
		referenced.every((token) => token.startsWith("--dsw-") || token.startsWith("--ds-") || token.startsWith("--dshas-")),
		referenced.join(", "),
	);
} else {
	const ownTokens = new Set([...cssText.matchAll(/(--dshas-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
	const unknownShipped = referenced.filter((token) => !token.startsWith("--dshas-") && !definedTokens.has(token));
		// `--dshas-freeze` is written per element from the script — it carries that element's own
	// frozen height — so it is the one own-prefixed token the stylesheet does not define.
	const unknownOwn = referenced.filter((token) => token.startsWith("--dshas-") && token !== "--dshas-freeze" && !ownTokens.has(token));
	check("css: every referenced shell token is defined by a shipped package", unknownShipped.length === 0, unknownShipped.join(", "));
	check("css: every --dshas-* token referenced is defined by this stylesheet", unknownOwn.length === 0, unknownOwn.join(", "));
}

//#endregion

//#region 8. apply() dry runs

function makeDom(width, height, sidebarState) {
	const attributes = new Map();
	const styleProperties = new Map();
	const documentListeners = [];
	const root = {
		clientWidth: width,
		clientHeight: height,
		setAttribute: (key, value) => attributes.set(key, value),
		getAttribute: (key) => (attributes.has(key) ? attributes.get(key) : null),
		removeAttribute: (key) => attributes.delete(key),
		hasAttribute: (key) => attributes.has(key),
		style: {
			setProperty: (key, value) => styleProperties.set(key, value),
			removeProperty: (key) => styleProperties.delete(key),
		},
	};
	const meta = {
		content: "width=device-width, initial-scale=1",
		getAttribute() {
			return this.content;
		},
		setAttribute(_key, value) {
			this.content = value;
		},
	};
	const head = {
		children: [],
		appendChild(node) {
			const index = head.children.indexOf(node);
			if (index >= 0) head.children.splice(index, 1);
			node.parentNode = head;
			head.children.push(node);
		},
		removeChild(node) {
			const index = head.children.indexOf(node);
			if (index >= 0) head.children.splice(index, 1);
			node.parentNode = null;
		},
	};
	const insideTarget = { label: "inside-the-sidebar" };
	const column = { contains: (node) => node === insideTarget };
	const document = {
		documentElement: root,
		head,
		createElement: () => {
			const attrs = {};
			return {
				parentNode: null,
				textContent: "",
				setAttribute: (key, value) => { attrs[key] = String(value); },
				getAttribute: (key) => (key in attrs ? attrs[key] : null),
				attributes: attrs,
			};
		},
		querySelector: (selector) => {
			if (selector === 'meta[name="viewport"]') return meta;
			if (selector === "[data-shell-overlay]") return sidebarState === "absent" ? null : { parentElement: { firstElementChild: column } };
			if (selector === "[data-sidebar-collapsed]") return sidebarState === "expanded" ? null : sidebarState === "absent" ? null : {};
			return null;
		},
		addEventListener: (type, fn, capture) => documentListeners.push([type, fn, capture === true]),
		removeEventListener: (type, fn) => {
			const index = documentListeners.findIndex((entry) => entry[0] === type && entry[1] === fn);
			if (index >= 0) documentListeners.splice(index, 1);
		},
	};
	return { root, meta, head, document, attributes, styleProperties, documentListeners, column, insideTarget };
}

/**
 * Mount the plugin against a synthetic viewport and return everything the
 * assertions need. The stubs answer the same questions a browser would for the
 * three things this plugin reads: the viewport box, `matchMedia`, and the
 * document's own meta tag.
 */
function mountPlugin(width, height, sidebarState, bootPayload) {
	const dom = makeDom(width, height, sidebarState === undefined ? "collapsed" : sidebarState);
	const domWindow = {
		location: { href: "http://127.0.0.1:3080/", origin: "http://127.0.0.1:3080" },
		innerWidth: width,
		innerHeight: height,
		addEventListener() {},
		removeEventListener() {},
		requestAnimationFrame: (callback) => {
			callback();
			return 0;
		},
		cancelAnimationFrame() {},
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	};
	const applied = loadClient({
		document: dom.document,
		window: domWindow,
		__DSH_BOOT__: bootPayload,
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
	}).exports;

	const injectedKeys = [];
	const registrations = [];
	const effectDisposers = [];
	const overrides = [];
	let toggles = 0;
	const ctx = {
		effect(callback, label) {
			const disposer = callback();
			effectDisposers.push({ label, disposer });
			return typeof disposer === "function" ? disposer : () => {};
		},
		slots: {
			inject(key, callback) {
				injectedKeys.push(key);
				return callback();
			},
			register(options, component) {
				registrations.push({ options, component });
				return () => {};
			},
		},
		locale: { register: () => () => {}, bind: () => (key) => key },
		theme: {
			overrideTokens(source, tokenMap) {
				overrides.push({ source, tokens: tokenMap });
				return () => {};
			},
		},
		layout: {
			toggleSidebar() {
				toggles += 1;
			},
		},
	};
	let applyError = null;
	try {
		applied.apply(ctx);
	} catch (error) {
		applyError = error;
	}
	const component = (id) => registrations.find((entry) => entry.options.id === id)?.component;
	return { applied, ctx, dom, injectedKeys, registrations, effectDisposers, overrides, applyError, component, toggles: () => toggles };
}

// --- a phone ----------------------------------------------------------------
const phone = mountPlugin(390, 844);
check("apply(): does not throw", phone.applyError === null, phone.applyError === null ? "" : phone.applyError.stack);

check(
	"apply(): occupies only additive seats (settings list, header nav, and a null state publisher)",
	phone.injectedKeys.length > 0 &&
		phone.injectedKeys.every((key) => key === "settings.general.item" || key === "conversation.header.leading" || key === "shell.overlay"),
	phone.injectedKeys.join(", "),
);
// The plugin may occupy `shell.overlay` only with a component that renders NOTHING: it
// publishes which main panel is showing so the stylesheet can scope the phone layout to
// the conversation. No element, so nothing can cover or capture.
const overlayEntries = phone.registrations.filter((entry) => entry.options.name === "shell.overlay");
check("apply(): the only shell.overlay occupant renders nothing", overlayEntries.length === 1 && overlayEntries[0].component({ usePanelInfo: () => null }) === null, String(overlayEntries.length));
check(
	"apply(): no element is ever rendered into shell.overlay",
	overlayEntries.every((entry) => entry.component({ usePanelInfo: () => "plugins" }) === null),
);
// The correction for the v1 lockout: the control that opens the sidebar must live
// OUTSIDE the sidebar and outside any overlay this plugin could own. The header
// seat is inside the conversation column, so it stays tappable while the sidebar
// is open, and nothing here can cover it.
check(
	"apply(): the sidebar toggle lives in the conversation column, not in the sidebar",
	phone.registrations.some((entry) => entry.options.id === "dsh-adaptive-shell.nav" && entry.options.name === "conversation.header.leading"),
);
check(
	"apply(): the sidebar toggle is the shell seat at default priority (nothing shadowed)",
	phone.registrations.find((entry) => entry.options.id === "dsh-adaptive-shell.nav")?.options.priority === undefined,
);
check("render: the sidebar toggle is offered on a narrow phone", phone.component("dsh-adaptive-shell.nav")({}) !== null);
const ids = phone.registrations.map((entry) => entry.options.id);
const rowIds = ids.filter((id) => /^dsh-adaptive-shell\.(enabled|form|density|touch|compat|miracle|push|readout)$/.test(id));
check("apply(): registers eight settings rows", rowIds.length === 8, rowIds.join(", "));
check(
	"apply(): every registration carries a component",
	phone.registrations.every((entry) => typeof entry.component === "function"),
);

check("apply(): stamps data-dsh-adaptive", phone.dom.attributes.get("data-dsh-adaptive") === "1");
check("apply(): 390x844 classifies as phone", phone.dom.attributes.get("data-dsh-adaptive-form") === "phone", String(phone.dom.attributes.get("data-dsh-adaptive-form")));
check("apply(): orientation stamped", phone.dom.attributes.get("data-dsh-adaptive-orient") === "portrait");
check("apply(): density stamped", phone.dom.attributes.get("data-dsh-adaptive-density") === "comfortable");
check("apply(): compat gate stamped by default", phone.dom.attributes.get("data-dsh-adaptive-compat") === "1");
check("apply(): the narrow mark is stamped below the shell breakpoint", phone.dom.attributes.get("data-dsh-adaptive-narrow") === "1");
check("apply(): the Miracle mark is stamped by default", phone.dom.attributes.get("data-dsh-adaptive-miracle") === "1");
check("apply(): the push mark is stamped by default", phone.dom.attributes.get("data-dsh-adaptive-push") === "1");
check("apply(): fine pointer leaves touch sizing off", phone.dom.attributes.has("data-dsh-adaptive-touch") === false);
check(
	"apply(): viewport declaration widened",
	/viewport-fit=cover/.test(phone.dom.meta.content) && /interactive-widget=resizes-content/.test(phone.dom.meta.content),
	phone.dom.meta.content,
);
check("apply(): stylesheet installed once", phone.dom.head.children.length === 1, String(phone.dom.head.children.length));
check(
	"apply(): the Miracle layer is stacked once",
	phone.overrides.length === 1 && phone.overrides[0].source === "dsh-adaptive-shell",
	JSON.stringify(phone.overrides.map((entry) => entry.source)),
);
check(
	"apply(): every Miracle token carries both schemes",
	phone.overrides.length === 1 && Object.values(phone.overrides[0].tokens).every((pair) => typeof pair?.light === "string" && typeof pair?.dark === "string"),
);
// Two passive observers exist: the collapse-motion shim (always, while motion is on) and the
// drawer's outside tap (only while a narrow phone has the drawer open). Neither may cancel an
// event, which the source-level assertion elsewhere pins.
// Two passive observers: the collapse-motion shim (always, while motion is on) and the drawer's
// outside tap (only while a narrow phone has the drawer open). Neither cancels an event.
// No height-owning shim is installed: it would have to own the card's clipping region as well,
// and every failure of that ownership is a visible defect on the device.
check("apply(): no document listener while the drawer is collapsed", phone.dom.documentListeners.length === 0, JSON.stringify(phone.dom.documentListeners.map((entry) => [entry[0], entry[2]])));

let disposeError = null;
try {
	for (const entry of phone.effectDisposers.slice().reverse()) {
		if (typeof entry.disposer === "function") entry.disposer();
	}
} catch (error) {
	disposeError = error;
}
check("dispose: does not throw", disposeError === null, disposeError === null ? "" : disposeError.message);
check("dispose: restores the viewport declaration", phone.dom.meta.content === "width=device-width, initial-scale=1", phone.dom.meta.content);
check("dispose: removes the stylesheet", phone.dom.head.children.length === 0, String(phone.dom.head.children.length));
check("dispose: removes every stamped attribute", phone.dom.attributes.size === 0, [...phone.dom.attributes.keys()].join(", "));

// --- the window that once broke --------------------------------------------
// A wide-but-short window classifies as "phone" by ratio while the frame still
// treats the sidebar as a normal column. v1 let a structural rule fire there and
// covered the app with an overlay nothing could dismiss. There is no overlay any
// more; this pins the marks so the regression cannot come back unnoticed.
const shortWide = mountPlugin(1100, 460);
check("regression: a wide-but-short window still classifies as phone", shortWide.dom.attributes.get("data-dsh-adaptive-form") === "phone", String(shortWide.dom.attributes.get("data-dsh-adaptive-form")));
check(
	"regression: but it carries no narrow mark, so no narrow-scoped rule matches",
	shortWide.dom.attributes.has("data-dsh-adaptive-narrow") === false,
	[...shortWide.dom.attributes.keys()].join(", "),
);
check("regression: it still renders no overlay element", shortWide.registrations.filter((entry) => entry.options.name === "shell.overlay").every((entry) => entry.component({ usePanelInfo: () => null }) === null));
check("regression: it offers no sidebar toggle (not narrow)", shortWide.component("dsh-adaptive-shell.nav")({}) === null);

// --- the drawer's outside tap ------------------------------------------------
// Phone + narrow + actually open, and nothing else. This is the plugin's only event
// listener, and the guard it needs is the fix for a self-triggering loop: the click
// that opens the drawer is still propagating when the observer arms itself, so an
// unguarded observer closes the drawer it was just opened by.
const expandedPhone = mountPlugin(390, 844, "expanded");
const shortWideOpen = mountPlugin(1100, 460, "expanded");
const drawerListeners = expandedPhone.dom.documentListeners.filter((entry) => entry[0] === "click" && entry[2] !== true);
check("dismiss: a click observer is armed while the drawer is open on a narrow phone", drawerListeners.length === 1, JSON.stringify(expandedPhone.dom.documentListeners.map((entry) => entry[0])));
check("dismiss: one passive click observer on a narrow phone with the drawer open", expandedPhone.dom.documentListeners.length === 1, String(expandedPhone.dom.documentListeners.length));
if (drawerListeners.length === 1) {
	const handler = drawerListeners[0][1];
	handler({ target: expandedPhone.dom.insideTarget });
	check("dismiss: a click inside the sidebar leaves it open", expandedPhone.toggles() === 0, String(expandedPhone.toggles()));
	handler({ target: { closest: () => ({}) } });
	check("dismiss: the click that came from this plugin's own button does NOT close the drawer", expandedPhone.toggles() === 0, String(expandedPhone.toggles()));
	handler({ target: { closest: () => null } });
	check("dismiss: a click outside the sidebar closes it once", expandedPhone.toggles() === 1, String(expandedPhone.toggles()));
	handler(null);
	check("dismiss: an event without a target is handled without throwing", expandedPhone.toggles() === 2, String(expandedPhone.toggles()));
}
let drawerDisposeError = null;
try {
	for (const entry of expandedPhone.effectDisposers.slice().reverse()) {
		if (typeof entry.disposer === "function") entry.disposer();
	}
} catch (error) {
	drawerDisposeError = error;
}
check("dismiss: dispose does not throw", drawerDisposeError === null, drawerDisposeError === null ? "" : drawerDisposeError.message);
check("dismiss: dispose removes every observer", expandedPhone.dom.documentListeners.length === 0, JSON.stringify(expandedPhone.dom.documentListeners.map((entry) => entry[0])));

// Where the rail was not removed there is nothing to dismiss, so no observer exists.
const freshPhone = mountPlugin(390, 844);
check(
	"dismiss: no observer while the drawer is collapsed",
	freshPhone.dom.documentListeners.length === 0,
	JSON.stringify(freshPhone.dom.documentListeners.map((entry) => [entry[0], entry[2]])),
);
check("dismiss: no observer on a wide-but-short window", shortWideOpen.dom.documentListeners.length === 0, String(shortWideOpen.dom.documentListeners.length));
check("nav: the open button is offered on a narrow phone", phone.component("dsh-adaptive-shell.nav")({}) !== null);
// The conversation's button is permanent: it is the control the user reaches for in
// both states, and hiding it while the drawer was open is what made a hooks-order
// violation fatal (the entry unmounted and never returned).
const collapsedButton = phone.component("dsh-adaptive-shell.nav")({});
const expandedButton = expandedPhone.component("dsh-adaptive-shell.nav")({});
check("nav: the button is present while the drawer is collapsed", collapsedButton !== null);
check("nav: the button is present while the drawer is open", expandedButton !== null);
check("nav: the button reports the drawer state", collapsedButton?.props?.["aria-expanded"] === "false" && expandedButton?.props?.["aria-expanded"] === "true");
check("nav: the label follows the state", collapsedButton?.props?.["aria-label"] !== expandedButton?.props?.["aria-label"]);

React.__hooks = 0;
phone.component("dsh-adaptive-shell.nav")({});
const hooksCollapsed = React.__hooks;
React.__hooks = 0;
expandedPhone.component("dsh-adaptive-shell.nav")({});
const hooksExpanded = React.__hooks;
check(
	"nav: the component calls the same number of hooks in both states (no hooks-order violation)",
	hooksCollapsed === hooksExpanded && hooksCollapsed > 0,
	"collapsed=" + hooksCollapsed + " expanded=" + hooksExpanded,
);
check("nav: no open button on a wide-but-short window", shortWideOpen.component("dsh-adaptive-shell.nav")({}) === null);

// --- idle prefetch: the honest form of "pre-render" --------------------------
// The module loader has no public warm-up call, but the shell publishes its boot
// manifest, so the module URLs for the slow panels can be prefetched on idle.
const bootPayload = {
	graph: {
		rev: "test",
		entries: [
			{ id: "@deepseek-ai/dsh-client-ui-jobs", url: "./assets/jobs-abc.js", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-subagent", url: "./assets/subagent-abc.js", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-sidebar", url: "./assets/sidebar-abc.js", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-conversation", url: "./assets/not-a-target.js", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-jobs", url: "https://example.com/assets/hostile.js", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-jobs", url: "./assets/not-script.css", rev: "1" },
			{ id: "@deepseek-ai/dsh-client-ui-jobs", url: "./outside/other.js", rev: "1" },
		],
		batches: [],
	},
};
const prefetched = mountPlugin(390, 844, "collapsed", bootPayload);
const hints = prefetched.dom.head.children.filter((node) => node.getAttribute !== undefined && node.getAttribute("rel") === "prefetch");
const hintHrefs = hints.map((node) => node.getAttribute("href")).sort();
check(
	"prefetch: exactly the listed panels get a script hint, resolved and deduplicated",
	hintHrefs.join("|") ===
		[
			"http://127.0.0.1:3080/assets/sidebar-abc.js",
			"http://127.0.0.1:3080/assets/subagent-abc.js",
			"http://127.0.0.1:3080/assets/jobs-abc.js",
		]
			.sort()
			.join("|"),
	hintHrefs.join(" | "),
);
check("prefetch: a cross-origin url is never hinted", !hintHrefs.some((href) => href.includes("example.com")));
check("prefetch: a non-script url is never hinted", !hintHrefs.some((href) => href.endsWith(".css")));
check("prefetch: a url outside /assets/ is never hinted", !hintHrefs.some((href) => href.includes("/outside/")));
check("prefetch: an unlisted module is never hinted", !hintHrefs.some((href) => href.includes("not-a-target")));

let prefetchDisposeError = null;
try {
	for (const entry of prefetched.effectDisposers.slice().reverse()) {
		if (typeof entry.disposer === "function") entry.disposer();
	}
} catch (error) {
	prefetchDisposeError = error;
}
check("prefetch: dispose does not throw", prefetchDisposeError === null, prefetchDisposeError === null ? "" : prefetchDisposeError.message);
check("prefetch: dispose removes the hints", prefetched.dom.head.children.filter((node) => node.getAttribute !== undefined && node.getAttribute("rel") === "prefetch").length === 0);

// A missing or hostile payload must produce no hints and no throw.
const noPayload = mountPlugin(390, 844, "collapsed");
check("prefetch: no boot payload means no hints and no failure", noPayload.dom.head.children.every((node) => node.getAttribute === undefined || node.getAttribute("rel") !== "prefetch") && noPayload.applyError === null);
const hostile = mountPlugin(390, 844, "collapsed", { graph: { entries: [{ id: "@deepseek-ai/dsh-client-ui-jobs", url: "javascript:alert(1)" }] } });
check("prefetch: a non-http url yields no hint", hostile.dom.head.children.every((node) => node.getAttribute === undefined || node.getAttribute("rel") !== "prefetch"));

// --- press feedback on the plugin's own button -------------------------------
const pressedButton = phone.component("dsh-adaptive-shell.nav")({});
check(
	"nav: the button reports press state from its own pointer events",
	pressedButton !== null && typeof pressedButton.props.onPointerDown === "function" && typeof pressedButton.props.onPointerUp === "function" && typeof pressedButton.props.onPointerCancel === "function",
);
check("nav: press feedback is a geometric change on the named press step", /data-dsh-adaptive-pressed[^{]*\{[^}]*transform:scale/.test(cssText) && cssText.includes("var(--dshas-motion-press)"));

// --- desktop ----------------------------------------------------------------
const desktop = mountPlugin(1440, 900);
check("desktop: classifies as desktop", desktop.dom.attributes.get("data-dsh-adaptive-form") === "desktop", String(desktop.dom.attributes.get("data-dsh-adaptive-form")));
check("desktop: no narrow mark", desktop.dom.attributes.has("data-dsh-adaptive-narrow") === false);
check("desktop: the settings rows still render", desktop.component("dsh-adaptive-shell.enabled")({}) !== null);
check("desktop: no sidebar toggle is offered", desktop.component("dsh-adaptive-shell.nav")({}) === null);

// --- motion: one gesture per kind of surface --------------------------------
// These were described in earlier rounds but their assertions were silently dropped by
// failed patch anchors, so the suite went green without covering the work. They live at
// the end of the file now, where appending cannot silently miss.
const propSet = (rule) => declarations(rule.body).map((declaration) => declaration.prop);

check(
	"cards: ONE scheme — thinking, command blocks, tool rows and the folded group read the same three tokens",
	parsed.some((rule) => {
		const selector = rule.selector;
		return (
			['[data-variant="think"]', '[data-sample="bash"]', "[data-tool]", '[data-chat-flow-kind="turn-process"]:not(:has('].every((mark) => selector.includes(mark)) &&
			rule.body.includes("background:var(--dshas-card-surface)") &&
			rule.body.includes("border-radius:var(--dshas-card-radius)") &&
			rule.body.includes("border:1px solid var(--dshas-card-hairline)")
		);
	}),
);
check(
	"cards: the scheme is defined in exactly one place, and the fill is the app's own raised layer",
	(cssText.match(/--dshas-card-surface:/g) || []).length === 1 && cssText.includes("--dshas-card-surface:var(--dsw-alias-bg-layer-1)"),
);
check(
	"cards: no surface keeps a private recipe of its own",
	!parsed.some(
		(rule) =>
			/\[data-(tool|sample)\]|\[data-variant="think"\]/.test(rule.selector) &&
			!rule.selector.includes(":not(:has(") &&
			rule.body.includes("background:var(--dsw-alias"),
	),
);
check(
	"cards: a run of thinking is still merged into one band",
	parsed.some((rule) => rule.selector.includes('[data-variant="think"] + [data-variant="think"]') && rule.body.includes("margin-top:-1px")) &&
		parsed.some((rule) => rule.selector.includes('[data-variant="think"]:has(+ [data-variant="think"])') && rule.body.includes("border-bottom-width:0")),
);
check(
	"cards: work in progress is marked by ONE declaration shared by both kinds of running row",
	parsed.some((rule) => rule.selector.includes('[data-sample="bash"][data-state="running"]') && rule.selector.includes('[data-tool][data-state="running"]') && rule.selector.includes('[data-variant="think"][data-state="running"]') && rule.body.includes("border-color:var(--dsw-alias-brand-primary)")),
);
check(
	"unfold: the disclosure root is a two-track grid in BOTH states, so the track can interpolate",
	parsed.some((rule) => rule.selector.includes(":has(> [data-disclosure-row])") && !rule.selector.includes("[data-open]") && rule.body.includes("grid-template-rows:auto 0fr")) &&
		parsed.some((rule) => rule.selector.includes("[data-open]:has(> [data-disclosure-row])") && rule.body.includes("grid-template-rows:auto 1fr")),
);
check(
	"unfold: the entrance decelerates and the exit accelerates on one shared duration",
	parsed.some((rule) => rule.selector.includes("[data-open]:has(> [data-disclosure-row])") && rule.body.includes("transition:grid-template-rows var(--dshas-motion-unfold) var(--dshas-motion-enter)")) &&
		parsed.some((rule) => rule.selector.includes(":has(> [data-disclosure-row])") && !rule.selector.includes("[data-open]") && rule.body.includes("transition:grid-template-rows var(--dshas-motion-unfold) var(--dshas-motion-exit)")),
);
check("unfold: nothing depends on interpolate-size (Chrome 129+) to work", !/interpolate-size/.test(cssText));
check(
	"cards: the border is a real 1px line in a visible ink role, not the 7%-alpha layer border",
	cssText.includes("--dshas-card-hairline:color-mix(in srgb, var(--dsw-alias-label-tertiary) 34%, transparent)") &&
		!cssText.includes("--dshas-card-hairline:var(--dsw-alias-border-l1)"),
);
check(
	"diagnostics: the readout reports live marker hit counts, so a wrong marker is visible instead of guessed",
	source.includes("function probeCounts()") &&
		source.includes("document.querySelectorAll(PROBE_MARKERS[i][1]).length") &&
		source.includes("probeCounts()") &&
		['[data-variant="think"]', '[data-sample="bash"]', "[data-tool]", '[data-chat-flow-kind="turn-process"]', "[data-turn-process-inline]", "[data-disclosure-row]", "[data-sidebar-right-panel]"].every((marker) => source.includes(marker)),
);
check(
	"cards: the command card is the element that CONTAINS the sample, because the shipped card is invisible",
	parsed.some((rule) => rule.selector.includes(':has(> [data-sample="bash"])') && rule.body.includes("background:var(--dshas-card-surface)")) &&
		parsed.some((rule) => rule.selector.includes('[data-sample="bash"]') && rule.body.includes("background:none")),
);

check(
	"cards: the thinking row is the real marker (`data-variant=\"think\"`), not the flow grouping",
	// `data-chat-group-part="reasoning"` only marks which half of a turn a node belongs to and is
	// absent on plenty of nodes, which is why the thinking card appeared and vanished. The row
	// itself carries `data-variant="think"`.
	parsed.some((rule) => rule.selector.includes('[data-variant="think"]') && rule.body.includes("background:var(--dshas-card-surface)")) &&
		!parsed.some(
			(rule) =>
				rule.selector.includes('[data-chat-group-part="reasoning"]') &&
				!rule.selector.includes(":not(:has(") &&
				rule.body.includes("background:var(--dshas-card-surface)"),
		),
);
check(
	"cards: a thinking row in progress is marked on the same declaration as the other runners",
	parsed.some((rule) => rule.selector.includes('[data-variant="think"][data-state="running"]') && rule.body.includes("border-color:var(--dsw-alias-brand-primary)")),
);

check(
	"cards: a FOLDED turn keeps its border — the group card tests for VISIBLE reasoning, not for reasoning",
	// A folded turn leaves its reasoning members in the DOM carrying `data-turn-process-hidden`,
	// so `:has(reasoning)` alone stayed true and the folded card lost its border.
	cssText.includes('turn-process"]:not(:has([data-chat-group-part="reasoning"]:not([data-turn-process-hidden])))') &&
		!cssText.includes('turn-process"]:not(:has([data-chat-group-part="reasoning"])){'),
);

check(
	"cards: a merged band cancels the doubled border edge between its parts",
	cssText.includes('[data-variant="think"] + [data-variant="think"]{margin-top:-1px;border-top-width:0') &&
		cssText.includes('border-bottom-width:0;border-bottom-left-radius:0'),
);

check(
	"unfold: every expandable in the transcript goes through ONE height push (samples and disclosures alike)",
	source.includes('target.closest("[data-expandable]")') &&
		source.includes('control.closest("[data-sample]")') &&
		source.includes("pushHeight(host, curve)"),
);
check(
	"unfold: the freeze is applied synchronously, before React commits the body's removal",
	/const total = host\.getBoundingClientRect\(\)\.height;[\s\S]{0,600}?collapseHeight\(host, Math\.round\(total\)/.test(source) &&
		!/requestAnimationFrame[\s\S]{0,200}?setAttribute\(\"data-dshas-closing\"/.test(source),
);
check(
	"unfold: the collapsed height is measured before the change, and the direction picks the curve",
	source.includes('control.getAttribute("aria-expanded") === "true"') && /pushHeight\(host, curve\)/.test(source),
);
check(
	"cards: [data-terminal] is only ever used as a detail marker INSIDE a tool row, never as the command sample",
	// The transcript's command output is `[data-sample="bash"]`. `[data-terminal]` is the
	// primitives' terminal block, which the shell uses inside tool detail bodies — an earlier
	// round mistook it for the command sample and styled an element no transcript contains.
	parsed.filter((rule) => rule.selector.includes("[data-terminal]")).every((rule) => rule.selector.includes("[data-tool]")),
);
check(
	"motion: transcript ROWS never scale (a row must move the flow, not grow out of its own centre)",
	!parsed.some((rule) => ["[data-tool]", "[data-terminal]"].some((mark) => rule.selector.includes(mark)) && rule.body.includes("transition:transform")),
);
check(
	"motion: the scale-expand is reserved for surfaces that float above the conversation",
	parsed.some((rule) => rule.selector.includes("[data-sidebar-right-panel]") && rule.body.includes("transform-origin:100% 50%")) &&
		parsed.some((rule) => rule.selector.includes('[role="dialog"]') && rule.body.includes("transform:scale") === false) &&
		parsed.some(
			(rule) =>
				rule.wrapper === "@starting-style" &&
				/transform:scale\(/.test(rule.body) &&
				rule.selector.includes("[data-sidebar-right-panel]") &&
				rule.selector.includes('[data-slot="main"]') &&
				rule.selector.includes('[data-slot="settings.section"]'),
		),
);

// Pages animate as well as sheets, and the conversation subtree is excluded from the main
// panel's entry so that a transform can never become the effort card's containing block.
check(
	"motion: pages get an entry, and the conversation's subtree is excluded from it",
	parsed.some((rule) => rule.selector.includes('[data-slot="main"]:not(:has([data-conversation-scroll]))') && rule.body.includes("transition:transform")) &&
		parsed.some((rule) => rule.selector.includes('[data-slot="settings.section"]') && rule.body.includes("transition:transform")) &&
		!parsed.some((rule) => rule.wrapper === "@starting-style" && rule.selector.includes('[data-slot="main"]') && !rule.selector.includes(":not(:has(")),
);
check(
	"codex-efforting: its card keeps every one of its own colours — only the growth origin is set",
	parsed.filter((rule) => rule.selector.includes(".efs-card")).every((rule) => propSet(rule).every((prop) => prop === "transform-origin" || prop === "max-width")),
);
check(
	"codex-efforting: the card is reached through the standard dialog role, not a private API",
	parsed.some((rule) => rule.selector.includes('[role="dialog"]')),
);
check(
	"motion: the master gate exists and every animated rule hangs off it",
	parsed.filter((rule) => /transition:|@starting-style/.test(rule.body) && rule.wrapper !== "@media (prefers-reduced-motion: reduce)").every((rule) => rule.selector.includes('data-dsh-adaptive-motion="1"') || rule.selector.includes("data-dsh-adaptive-nav") || rule.selector.includes("data-dsh-adaptive-row") || rule.selector.includes("data-dsh-adaptive-switch")),
);

check(
	"settings: no structural guess about the panel layout survives — the chain probe replaces it",
	// The reverted attempt matched the wrong nodes and squeezed the section column into vertical
	// strips. Until the live chain has been read, nothing here may address the panel structurally.
	!cssText.includes("*:has(> *:has(+ *:has(") && !cssText.includes("*:has(+ *:has("),
);
check(
	"settings: the readout reports the panel's element chain, with each node's measured width",
	source.includes("function settingsChain()") &&
		source.includes('document.querySelector(\'[data-slot="settings.section"]\')') &&
		source.includes("getBoundingClientRect().width") &&
		source.includes("settingsChain()"),
);

check(
	"settings: the scroll chain is complete — a stacked panel must let its content shrink",
	// Stacking the panel turns the content column into a column-axis flex item, where
	// `min-height:auto` refuses to shrink, the inner `overflow-y:auto` never gets a bounded
	// height, and the whole sheet stops scrolling. This is that defect, pinned.
	parsed.some((rule) => rule.selector === SETTINGS_STRUCTURE[0] && rule.body.includes("flex-direction:column;width:100%")) &&
		parsed.some((rule) => rule.selector === SETTINGS_CONTENT && rule.body.includes("flex:1;min-height:0")),
);
check(
	"settings: a row of three or more choices becomes three across, so appearance is not a column",
	parsed.some((rule) => rule.selector.includes(':has(> button:nth-child(3))') && rule.body.includes("grid-template-columns:repeat(3,minmax(0,1fr))")) &&
		parsed.every((rule) => rule.selector.includes("settings.general.item") || !rule.selector.includes(":has(> button:nth-child(3))")),
);
check(
	"settings: the close control is lifted to the sheet corner and the strip reserves its space",
	parsed.some((rule) => rule.selector === SETTINGS_CLOSE && rule.body.includes("position:absolute")) &&
		parsed.some((rule) => rule.selector === SETTINGS_STRIP && rule.body.includes("calc(52px + env(safe-area-inset-right))")),
);

check(
	"cards: the detail bodies read the same three tokens as the thinking row and the overview",
	// The last holdout: each shipped detail body had its own radius, border alpha, fill and
	// padding, so an expanded call looked like a different design from the row that opened it.
	["[data-sample]", "[data-diff]", "[data-code-block]", "[data-terminal]"].every((marker) =>
		parsed.some((rule) => rule.selector.includes("[data-tool] :has(> " + marker + ")") && rule.body.includes("background:var(--dshas-card-surface)") && rule.body.includes("border:1px solid var(--dshas-card-hairline)")),
	),
);
check(
	"cards: an inner detail marker gives up its own box, so a body shows one border and not two",
	parsed.some((rule) => rule.selector.includes("[data-tool] [data-diff]") && rule.body.includes("background:none") && rule.body.includes("border:0")),
);

check(
	"motion: content unfolding has its own named duration, longer than the drawer's",
	// A panel that grows over a long distance cannot read at the drawer's 260ms; the two are
	// separate named steps in the one scale rather than a literal typed at a call site.
	/--dshas-motion-unfold:(\d+)ms/.test(cssText) &&
		Number(/--dshas-motion-unfold:(\d+)ms/.exec(cssText)[1]) > Number(/--dshas-motion-drawer:(\d+)ms/.exec(cssText)[1]) &&
		!/transition:grid-template-rows var\(--dshas-motion-drawer\)/.test(cssText),
);

check(
	"desktop: the transcript cards answer the cursor with ink, and nothing moves",
	parsed.some((rule) => rule.wrapper === POINTER_GATE && rule.selector.includes('[data-variant="think"]:hover') && rule.body.includes("border-color:")) &&
		!parsed.some((rule) => rule.wrapper === POINTER_GATE && rule.body.includes("transform")),
);
check(
	"desktop: the wide-screen reading measure is gated on its own switch, so a phone never pays",
	cssText.includes('html[data-dsh-adaptive-wideReading="1"] [data-conversation-scroll]') &&
		source.includes('const A_WIDE = "data-dsh-adaptive-wideReading"') &&
		source.includes("prefsNow.wide && wide"),
);
check(
	"desktop: the measure is only stamped on a wide desktop viewport",
	source.includes('const wide = verdict.form === "desktop" && size.w >= 1280;'),
);
check(
	"settings: the desktop additions are switchable from the settings page",
	source.includes('{ id: PKG + ".wide", order: 48, kind: "switch", field: "wide"'),
);
check(
	"codex-efforting: the growth origin is bottom-centre, since the card clamps its left edge",
	cssText.includes(".efs-card{transform-origin:50% 100%}"),
);

check(
	"diagnostics: the build stamp is ONE constant, and it matches package.json",
	// It used to be two hand-written strings. They drifted, and then the plugin reported a version
	// that was not the one running — a diagnostic that lies is worse than none at all.
	(() => {
		const declared = /const BUILD = "(\d+\.\d+\.\d+)"/.exec(source);
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
		return declared !== null && declared[1] === pkg.version;
	})(),
);
check(
	"desktop: the wide-reading preference has a store default, so the attribute can actually be stamped",
	source.includes('const PREF_DEFAULTS = {')
		? /PREF_DEFAULTS = \{[^}]*wide: (true|false)/.test(source)
		: false,
);

//#endregion

report();
