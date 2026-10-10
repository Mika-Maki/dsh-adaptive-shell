/**
 * dsh-adaptive-shell, browser half — v2.
 *
 * ## What this plugin is now
 *
 * Two independent contributions, neither of which can trap the user:
 *
 *  1. **Adaptive geometry** — the phone/tablet/desktop verdict is stamped on
 *     `<html>` as `data-dsh-adaptive-*`, and a handful of rules use it to give
 *     the composer and the conversation header the safe-area insets a notched
 *     device needs, to reclaim horizontal room on a narrow screen, and to grow
 *     touch targets on a coarse pointer.
 *  2. **The Miracle palette** — one `ctx.theme.overrideTokens` layer.
 *
 * ## The invariant that matters: this plugin adds no interaction state
 *
 * v1 shipped a full-frame click-catching scrim plus a drawer, and put the only
 * close button underneath that scrim. One tap therefore produced a state the
 * user could not leave: the conversation was covered (so it could neither be
 * tapped nor — since the scrim is not a descendant of the transcript's scroll
 * container — scrolled), while the sidebar and the settings modal stayed usable
 * above it. Only a reload escaped. That whole class of failure is removed by
 * construction here:
 *
 *  - **no overlay element of any kind** — nothing this plugin renders covers
 *    anything, so `pointer-events` is never mentioned anywhere in its stylesheet;
 *  - **no positioning** — `position`, `inset` and `z-index` appear nowhere, so no
 *    element this plugin introduces can sit on top of another;
 *  - **exactly one structural rule**: on a narrow phone the collapsed 56px rail
 *    track is zeroed so the conversation gets the full width. It is gated on
 *    `narrow`, on the `phone` form AND on the frame's own collapsed mark, so it
 *    can only ever remove empty space. Nothing else in the stylesheet references a
 *    frame marker;
 *  - **exactly one sidebar control is ever on screen** — the open button in the
 *    conversation header exists only while the sidebar is collapsed, and the shell's
 *    own toggle inside the sidebar takes over once it is open. It lives outside the
 *    state it opens and can never be covered. This is precisely what v1 got wrong;
 *  - **the only event listener is a passive observer** — tapping outside the open
 *    drawer closes it on a narrow phone. The handler never calls `preventDefault`
 *    or `stopPropagation`, is attached only while the drawer is actually open, and
 *    is removed the moment it is not. The plugin calls neither of those two methods
 *    anywhere, which is what keeps a touch scroll out of its reach;
 *  - **no height override** — `100dvh` on an inner container resizes the layout
 *    mid-gesture on a phone, a known way to lose a touch scroll, so the shipped
 *    `100%` chain is left alone.
 *
 * What remains cannot freeze anything: padding, one grid track that is only ever
 * emptied, minimum control sizes, colours. `test/smoke.mjs` asserts each bullet.
 *
 * ## Failure behaviour
 *
 * Every step is defensive and every failure degrades to the shipped interface:
 * with no attributes stamped, no rule matches and the app is exactly what it was
 * before installation. Nothing is written outside the live document except the
 * plugin's own preference key in `localStorage`.
 *
 * @module dsh-adaptive-shell
 */

window.__ModuleLoader__.load({
	id: "dsh-adaptive-shell",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const PKG = "dsh-adaptive-shell";
		/**
		 * Build identity, stamped into BOTH halves and checked against package.json by the suite.
		 * It used to be two hand-written strings that silently drifted and then reported a version
		 * that was not running — a diagnostic that lies is worse than no diagnostic.
		 */
		const BUILD = "5.4.0";
		const NS = "adaptiveShell";
		const PREF_KEY = PKG + "/preferences";

		const ATTR = "data-dsh-adaptive";
		const A_FORM = "data-dsh-adaptive-form";
		const A_ORIENT = "data-dsh-adaptive-orient";
		const A_DENSITY = "data-dsh-adaptive-density";
		const A_TOUCH = "data-dsh-adaptive-touch";
		const A_COMPAT = "data-dsh-adaptive-compat";
		const A_NARROW = "data-dsh-adaptive-narrow";
		const A_MIRACLE = "data-dsh-adaptive-miracle";
		const A_PUSH = "data-dsh-adaptive-push";
		/**
		 * Which main panel is showing. `main` is a keyed slot whose reserved
		 * `conversation` key hosts the Conversation; every other key is a "main page"
		 * (the Plugins page today). The phone layout is scoped to the Conversation
		 * because that is where this plugin's own header seat exists — on every other
		 * main page the shell keeps its 56px rail and its own sidebar toggle, so the
		 * sidebar stays reachable without this plugin covering or injecting anything.
		 */
		const A_PANEL = "data-dsh-adaptive-panel";
		/**
		 * Motion master switch. Stamped only while the plugin is on AND the user has not
		 * asked for reduced motion, so every animated rule is inert at the source rather
		 * than relying on a media query alone. Motion is deliberately NOT gated on the
		 * Miracle palette: turning the colours off must not silently turn the animation off.
		 */
		const A_MOTION = "data-dsh-adaptive-motion";
		/** Desktop reading measure switch (`data-dsh-adaptive-wide-reading`). */
		const A_WIDE = "data-dsh-adaptive-wideReading";
		const PANEL_CONVERSATION = "conversation";

		// Read-only diagnostic markers. The plugin observes these to *report* the
		// sidebar state in its settings row; it never writes them and never derives
		// an action from them.
		const FRAME_MARK = "[data-shell-overlay]";
		const COLLAPSED_MARK = "[data-sidebar-collapsed]";

		/** Classification thresholds. Changing these is the whole "screen ratio" policy. */
		const RULES = {
			phoneWidth: 600,
			tabletWidth: 1024,
			narrowWidth: 1024,
			shortSide: 480,
			wideRatio: 2.4,
			compactHeight: 560,
		};

		//#region classification

		/**
		 * Resolve one viewport into a form factor.
		 *
		 * Width decides on its own up to 600 CSS px. A short-and-wide viewport (a
		 * phone held sideways, ~844x390) is a phone too, but a merely short window
		 * (1280x470, ratio 2.7) is not: the ratio guard keeps that case out.
		 *
		 * @param width - viewport width in CSS px.
		 * @param height - viewport height in CSS px.
		 * @param override - `auto`, or a forced form.
		 * @returns the form, orientation, density and aspect ratio.
		 */
		function classify(width, height, override) {
			const w = Math.max(1, Math.round(width));
			const h = Math.max(1, Math.round(height));
			const ratio = w / h;
			let form;
			if (override === "phone" || override === "tablet" || override === "desktop") form = override;
			else if (w <= RULES.phoneWidth) form = "phone";
			else if (h <= RULES.shortSide && ratio <= RULES.wideRatio) form = "phone";
			else if (w <= RULES.tabletWidth) form = "tablet";
			else form = "desktop";
			return {
				form: form,
				orient: h > w ? "portrait" : "landscape",
				density: h <= RULES.compactHeight ? "compact" : "comfortable",
				ratio: ratio,
			};
		}

		//#endregion

		//#region preferences

		/**
		 * Preferences live in `localStorage` rather than in the plugin Config.
		 *
		 * A Host Config would need a schema plus a projection service to reach the
		 * browser half; the trade-off is that the choice is per-browser rather than
		 * per-profile, which is the right scope for a per-device layout switch.
		 */
		const PREF_DEFAULTS = { enabled: true, form: "auto", density: "auto", touch: true, compat: true, miracle: true, push: true, wide: false };
		const PREF_FORMS = ["auto", "phone", "tablet", "desktop"];
		const PREF_DENSITIES = ["auto", "on", "off"];

		function createPrefStore() {
			let state = Object.assign({}, PREF_DEFAULTS);
			const listeners = new Set();
			try {
				const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREF_KEY) : null;
				if (raw !== null) {
					const saved = JSON.parse(raw);
					if (typeof saved.enabled === "boolean") state.enabled = saved.enabled;
					if (typeof saved.touch === "boolean") state.touch = saved.touch;
					if (typeof saved.compat === "boolean") state.compat = saved.compat;
					if (typeof saved.miracle === "boolean") state.miracle = saved.miracle;
					if (typeof saved.push === "boolean") state.push = saved.push;
					if (PREF_FORMS.indexOf(saved.form) >= 0) state.form = saved.form;
					if (PREF_DENSITIES.indexOf(saved.density) >= 0) state.density = saved.density;
				}
			} catch (error) {
				/* 存储不可用或内容损坏时回落到默认值 */
			}
			const emit = () => {
				listeners.forEach((fn) => {
					try {
						fn();
					} catch (error) {
						/* 一个订阅者出错不影响其他订阅者 */
					}
				});
			};
			return {
				get: () => state,
				set(field, value) {
					if (state[field] === value) return;
					state = Object.assign({}, state, { [field]: value });
					try {
						if (typeof localStorage !== "undefined") localStorage.setItem(PREF_KEY, JSON.stringify(state));
					} catch (error) {
						/* 写入失败不影响本次会话 */
					}
					emit();
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
			};
		}

		//#endregion

		//#region runtime

		/**
		 * Read the layout viewport.
		 *
		 * `documentElement.client*` is preferred over `window.inner*` because it does
		 * not move when a mobile browser collapses its URL bar or opens the software
		 * keyboard: the verdict must not flap while the user types. Falls back to
		 * `inner*`, and reports failure rather than guessing.
		 *
		 * @returns `{ w, h }` in CSS px, or null when nothing usable is readable.
		 */
		function readViewport() {
			try {
				const root = document.documentElement;
				let w = root.clientWidth || 0;
				let h = root.clientHeight || 0;
				if (!w || !h) {
					w = window.innerWidth || 0;
					h = window.innerHeight || 0;
				}
				if (!w || !h) return null;
				return { w: w, h: h };
			} catch (error) {
				return null;
			}
		}

		function mql(query) {
			try {
				return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
			} catch (error) {
				return null;
			}
		}

		/** Build the media-query list whose answers are the cheap part of the trigger set. */
		function buildTriggers(schedule) {
			const queries = [
				"(width <= " + RULES.phoneWidth + "px)",
				"(width <= " + RULES.tabletWidth + "px)",
				"(height <= " + RULES.shortSide + "px)",
				"(height <= " + RULES.compactHeight + "px)",
				"(orientation: portrait)",
				"(pointer: coarse)",
				"(any-pointer: coarse)",
			];
			const lists = [];
			for (let i = 0; i < queries.length; i++) {
				const list = mql(queries[i]);
				if (list === null) continue;
				const onChange = () => schedule();
				if (typeof list.addEventListener === "function") list.addEventListener("change", onChange);
				else if (typeof list.addListener === "function") list.addListener(onChange);
				lists.push({ list: list, onChange: onChange });
			}
			return lists;
		}

		function releaseTriggers(lists) {
			for (let i = 0; i < lists.length; i++) {
				const entry = lists[i];
				try {
					if (typeof entry.list.removeEventListener === "function") entry.list.removeEventListener("change", entry.onChange);
					else if (typeof entry.list.removeListener === "function") entry.list.removeListener(entry.onChange);
				} catch (error) {
					/* 释放失败不阻塞卸载 */
				}
			}
		}

		function coarsePointer() {
			const a = mql("(pointer: coarse)");
			const b = mql("(any-pointer: coarse)");
			return Boolean((a !== null && a.matches) || (b !== null && b.matches));
		}

		/**
		 * The viewport watcher.
		 *
		 * Owns one rAF-coalesced `apply()`, one media-query trigger set, and the
		 * published snapshot. Every write is a no-op when the value did not change, so
		 * a `resize` storm costs at most one frame of comparison. It writes attribute
		 * marks only — never element styles, never event listeners, never state any
		 * other code has to agree with.
		 *
		 * @param prefs - the preference store.
		 * @returns `{ start, stop, get, subscribe }`.
		 */
		function createRuntime(prefs) {
			const blank = {
				enabled: false,
				form: "desktop",
				orient: "landscape",
				density: "comfortable",
				touch: false,
				compat: true,
				miracle: true,
				push: true,
				motion: false,
				wide: true,
				narrow: false,
				width: 0,
				height: 0,
				ratio: 0,
			};
			let snapshot = blank;
			let written = null;
			let frame = 0;
			let triggers = [];
			let running = false;
			const listeners = new Set();

			const emit = () => {
				listeners.forEach((fn) => {
					try {
						fn();
					} catch (error) {
						/* 一个订阅者出错不影响其他订阅者 */
					}
				});
			};

			const clearMarks = () => {
				try {
					const root = document.documentElement;
					root.removeAttribute(ATTR);
					root.removeAttribute(A_FORM);
					root.removeAttribute(A_ORIENT);
					root.removeAttribute(A_DENSITY);
					root.removeAttribute(A_TOUCH);
					root.removeAttribute(A_COMPAT);
					root.removeAttribute(A_NARROW);
					root.removeAttribute(A_MIRACLE);
					root.removeAttribute(A_PUSH);
					root.removeAttribute(A_PANEL);
					root.removeAttribute(A_MOTION);
					root.removeAttribute(A_WIDE);
					root.removeAttribute("data-dsh-adaptive-build-js");
					root.style.removeProperty("--dsh-adaptive-vw");
					root.style.removeProperty("--dsh-adaptive-vh");
					root.style.removeProperty("--dsh-adaptive-ratio");
				} catch (error) {
					/* 摘标记失败时后续标志位仍然一致 */
				}
			};

			const apply = () => {
				const prefsNow = prefs.get();
				const size = readViewport();
				if (size === null || !prefsNow.enabled) {
					clearMarks();
					written = null;
					if (snapshot.enabled !== false) {
						snapshot = Object.assign({}, blank, { compat: prefsNow.compat, miracle: prefsNow.miracle, push: prefsNow.push });
						emit();
					}
					return;
				}

				const verdict = classify(size.w, size.h, prefsNow.form);
				let density = verdict.density;
				if (prefsNow.density === "on") density = "compact";
				else if (prefsNow.density === "off") density = "comfortable";
				const touch = prefsNow.touch === true && coarsePointer();
				const reducedMotion = mql("(prefers-reduced-motion: reduce)");
				const motion = reducedMotion === null || !reducedMotion.matches;
				const wide = verdict.form === "desktop" && size.w >= 1280;
				const narrow = size.w < RULES.narrowWidth;

				const key =
					verdict.form +
					"|" +
					verdict.orient +
					"|" +
					density +
					"|" +
					(touch ? "1" : "0") +
					"|" +
					(prefsNow.compat ? "1" : "0") +
					"|" +
					(prefsNow.miracle ? "1" : "0") +
					"|" +
					(prefsNow.push ? "1" : "0") +
					"|" +
					(prefsNow.wide && wide ? "1" : "0") +
					"|" +
					(motion ? "1" : "0") +
					"|" +
					(narrow ? "1" : "0");
				if (written !== key) {
					written = key;
					try {
						const root = document.documentElement;
						root.setAttribute(ATTR, "1");
						// Build stamps: the stylesheet always arrives fresh, the script module is
						// fetched by a rev-bearing URL and can be served from cache. Reading both
						// tells you which half is actually running.
						root.setAttribute("data-dsh-adaptive-build-js", BUILD + "-js");
						root.setAttribute(A_FORM, verdict.form);
						root.setAttribute(A_ORIENT, verdict.orient);
						root.setAttribute(A_DENSITY, density);
						if (touch) root.setAttribute(A_TOUCH, "1");
						else root.removeAttribute(A_TOUCH);
						if (prefsNow.compat) root.setAttribute(A_COMPAT, "1");
						else root.removeAttribute(A_COMPAT);
						if (narrow) root.setAttribute(A_NARROW, "1");
						else root.removeAttribute(A_NARROW);
						if (prefsNow.miracle) root.setAttribute(A_MIRACLE, "1");
						else root.removeAttribute(A_MIRACLE);
						if (prefsNow.push) root.setAttribute(A_PUSH, "1");
						else root.removeAttribute(A_PUSH);
						if (motion) root.setAttribute(A_MOTION, "1");
						else root.removeAttribute(A_MOTION);
						// Only meaningful where there is width to spare, so it is stamped only above
						// the desktop breakpoint: a phone never pays for the rule.
						if (prefsNow.wide && wide) root.setAttribute(A_WIDE, "1");
						else root.removeAttribute(A_WIDE);
						root.style.setProperty("--dsh-adaptive-vw", size.w + "px");
						root.style.setProperty("--dsh-adaptive-vh", size.h + "px");
						root.style.setProperty("--dsh-adaptive-ratio", String(Math.round(verdict.ratio * 1000) / 1000));
					} catch (error) {
						// Stamping failed: with no marks, no rule matches and the interface
						// stays exactly as shipped. Say so once instead of failing silently.
						console.warn("[" + PKG + "] could not stamp the viewport marks; keeping the shipped layout:", error);
					}
				}

				if (
					snapshot.form !== verdict.form ||
					snapshot.orient !== verdict.orient ||
					snapshot.density !== density ||
					snapshot.touch !== touch ||
					snapshot.compat !== prefsNow.compat ||
					snapshot.miracle !== prefsNow.miracle ||
					snapshot.push !== prefsNow.push ||
					snapshot.wide !== (prefsNow.wide && wide) ||
					snapshot.motion !== motion ||
					snapshot.narrow !== narrow ||
					snapshot.width !== size.w ||
					snapshot.height !== size.h
				) {
					snapshot = {
						enabled: true,
						form: verdict.form,
						orient: verdict.orient,
						density: density,
						touch: touch,
						compat: prefsNow.compat,
						miracle: prefsNow.miracle,
						push: prefsNow.push,
						wide: prefsNow.wide && wide,
						motion: motion,
						narrow: narrow,
						width: size.w,
						height: size.h,
						ratio: verdict.ratio,
					};
					emit();
				}
			};

			const schedule = () => {
				if (!running || frame !== 0) return;
				try {
					frame = window.requestAnimationFrame(() => {
						frame = 0;
						apply();
					});
				} catch (error) {
					frame = 0;
					apply();
				}
			};

			const onResize = () => schedule();
			const unsubscribePrefs = prefs.subscribe(schedule);

			return {
				start() {
					if (running) return;
					running = true;
					triggers = buildTriggers(schedule);
					try {
						window.addEventListener("resize", onResize, { passive: true });
						window.addEventListener("orientationchange", onResize, { passive: true });
					} catch (error) {
						/* 事件注册失败：仍然做一次初始判定 */
					}
					apply();
				},
				stop() {
					running = false;
					if (frame !== 0) {
						try {
							window.cancelAnimationFrame(frame);
						} catch (error) {
							/* 忽略 */
						}
						frame = 0;
					}
					releaseTriggers(triggers);
					triggers = [];
					try {
						window.removeEventListener("resize", onResize);
						window.removeEventListener("orientationchange", onResize);
					} catch (error) {
						/* 忽略 */
					}
					unsubscribePrefs();
					written = null;
					clearMarks();
				},
				get: () => snapshot,
				subscribe(fn) {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
			};
		}

		//#endregion

		//#region drawer dismissal

		/** Whether the frame currently reports a collapsed sidebar. Read-only. */
		function sidebarCollapsed() {
			try {
				return document.querySelector(COLLAPSED_MARK) !== null;
			} catch (error) {
				return true;
			}
		}

		/** The frame's sidebar column, located structurally rather than by class name. */
		function sidebarColumn() {
			try {
				const layer = document.querySelector(FRAME_MARK);
				const frame = layer === null ? null : layer.parentElement;
				return frame === null ? null : frame.firstElementChild;
			} catch (error) {
				return null;
			}
		}

		/**
		 * Tap-outside-to-close for the phone drawer.
		 *
		 * The open button lives in the conversation header and is hidden while the
		 * drawer is open (the drawer covers that corner), so closing has to be possible
		 * from the part of the conversation the drawer left uncovered.
		 *
		 * This is a passive observer, not a gesture handler, and that distinction is the
		 * whole safety argument: the handler never calls `preventDefault` or
		 * `stopPropagation` (the plugin calls neither anywhere), so it cannot cancel a
		 * tap, a wheel or a touch scroll. It listens for `click` rather than `pointerdown`
		 * precisely because the tap must finish dispatching before the drawer moves the
		 * content it landed on — which is also why it must ignore the click that came from
		 * this plugin's own open button: that click is the trigger, not a dismissal. It is attached only while a narrow phone
		 * actually has the drawer open, and removed on the next state change and on
		 * dispose. If it ever misfired, the worst outcome is a sidebar that closed when
		 * the user tapped the conversation — the intended behaviour anyway.
		 *
		 * @param runtime - the viewport runtime, for the form factors.
		 * @param getLayout - reads the layout service, which may be unavailable.
		 * @returns `{ start }`, whose return value removes the observer.
		 */
		function createDrawerDismiss(runtime, getLayout) {
			let observer = null;
			let listening = false;
			let onPointerDown = null;

			const shouldListen = () => {
				const state = runtime.get();
				if (!state.enabled || !state.narrow || state.form !== "phone") return false;
				// Nothing to dismiss while the frame already reports it collapsed.
				return !sidebarCollapsed();
			};

			const close = () => {
				const layout = getLayout();
				if (layout === null) return;
				try {
					layout.toggleSidebar();
				} catch (error) {
					console.warn("[" + PKG + "] closing the sidebar from an outside tap failed:", error);
				}
			};

			const detach = () => {
				if (!listening || onPointerDown === null) return;
				try {
					document.removeEventListener("click", onPointerDown);
				} catch (error) {
					/* 忽略 */
				}
				listening = false;
				onPointerDown = null;
			};

			const attach = () => {
				if (listening) return;
				onPointerDown = (event) => {
					try {
						const target = event === null || event === undefined ? null : event.target;
						// The click that OPENED the drawer is still propagating when the state
						// change arms this observer (a MutationObserver callback runs in a
						// microtask, and microtasks drain between listeners), so the observer
						// meets its own trigger. Without this guard the open button opens and the
						// same event immediately closes it again — the sidebar can never open.
						if (target !== null && typeof target.closest === "function" && target.closest("[data-dsh-adaptive-nav]") !== null) return;
						const column = sidebarColumn();
						if (column !== null && target !== null && typeof column.contains === "function" && column.contains(target)) return;
						close();
					} catch (error) {
						/* 一次失败不影响这次点击 */
					}
				};
				// `click`, in the bubble phase: the application's own handler for the tap has
				// already run by then, so closing cannot move anything out from under a tap
				// that is still being dispatched. Nothing about the event is modified.
				document.addEventListener("click", onPointerDown);
				listening = true;
			};

			const sync = () => {
				if (shouldListen()) attach();
				else detach();
			};

			return {
				start() {
					const unsubscribe = runtime.subscribe(sync);
					try {
						observer = new MutationObserver(sync);
						observer.observe(document.documentElement, {
							subtree: true,
							attributes: true,
							attributeFilter: ["data-sidebar-collapsed"],
						});
					} catch (error) {
						console.warn("[" + PKG + "] could not watch the drawer state:", error);
						observer = null;
					}
					sync();
					return () => {
						unsubscribe();
						detach();
						if (observer !== null) observer.disconnect();
						observer = null;
					};
				},
			};
		}

		//#endregion

		//#region idle prefetch

		/**
		 * The panels whose first open is slow enough to feel, by client module id.
		 *
		 * These are opened on demand: their module script is fetched, its factory runs
		 * (which injects the panel's stylesheet), and the panel mounts — all on the click
		 * that first needs it. Warm hints move the fetch off that click.
		 */
		const PREFETCH_TARGETS = [
			"@deepseek-ai/dsh-client-ui-sidebar",
			"@deepseek-ai/dsh-client-ui-sidebar-right",
			"@deepseek-ai/dsh-client-ui-jobs",
			"@deepseek-ai/dsh-client-ui-subagent",
			"@deepseek-ai/dsh-experimental-client-ui-agent-team",
		];

		/** Depth- and count-bounded walk for the boot manifest's module rows. */
		function findModuleRows(node, depth) {
			if (depth > 4 || node === null || typeof node !== "object") return [];
			if (Array.isArray(node)) {
				const rows = [];
				for (let i = 0; i < node.length && rows.length < 400; i++) {
					const item = node[i];
					if (item !== null && typeof item === "object" && typeof item.id === "string" && typeof item.url === "string") rows.push(item);
				}
				if (rows.length > 0) return rows.slice(0, 400);
				for (let i = 0; i < node.length; i++) {
					const found = findModuleRows(node[i], depth + 1);
					if (found.length > 0) return found;
				}
				return [];
			}
			const keys = Object.keys(node);
			for (let i = 0; i < keys.length; i++) {
				const found = findModuleRows(node[keys[i]], depth + 1);
				if (found.length > 0) return found;
			}
			return [];
		}

		/**
		 * One-shot idle prefetch for the panels a user waits on.
		 *
		 * This is the only honest form of "pre-render" a plugin can perform here: the
		 * module loader exposes no public warm-up call — materialization happens on first
		 * import — but the shell publishes its boot manifest on `globalThis.__DSH_BOOT__`,
		 * so the module URLs are readable. Placing a `prefetch` hint for exactly the listed
		 * ids moves the network/disk part of the first open off the click, without running
		 * anything, without touching another plugin's state and without a private API.
		 *
		 * Safety envelope: the payload is walked with a depth bound, only same-origin
		 * `.js` URLs under `/assets/` are accepted (a malformed or hostile payload cannot
		 * make this document fetch anything else), hints are added once, at idle, and are
		 * removed on dispose.
		 *
		 * @returns `{ start }`, whose return value removes the hints.
		 */
		function createPanelPrefetch() {
			const links = [];
			const place = () => {
				try {
					const boot = globalThis.__DSH_BOOT__;
					if (boot === null || boot === undefined || typeof boot !== "object") return;
					const rows = findModuleRows(boot, 0);
					if (rows.length === 0) return;
					const origin = window.location.origin;
					for (let i = 0; i < rows.length; i++) {
						const row = rows[i];
						if (PREFETCH_TARGETS.indexOf(row.id) < 0) continue;
						let href = null;
						try {
							const url = new URL(row.url, window.location.href);
							if (url.origin !== origin) continue;
							if (!/\.js$/.test(url.pathname)) continue;
							if (url.pathname.indexOf("/assets/") < 0) continue;
							href = url.href;
						} catch (error) {
							continue;
						}
						if (href === null || links.some((link) => link.getAttribute("href") === href)) continue;
						const link = document.createElement("link");
						link.setAttribute("rel", "prefetch");
						link.setAttribute("as", "script");
						link.setAttribute("href", href);
						link.setAttribute("data-plugin", PKG);
						document.head.appendChild(link);
						links.push(link);
					}
				} catch (error) {
					console.warn("[" + PKG + "] idle prefetch skipped:", error);
				}
			};
			return {
				start() {
					let handle = 0;
					try {
						if (typeof window.requestIdleCallback === "function") {
							handle = window.requestIdleCallback(place, { timeout: 4000 });
						} else {
							handle = window.setTimeout(place, 2500);
						}
					} catch (error) {
						place();
					}
					return () => {
						try {
							if (handle !== 0) {
								if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle);
								else window.clearTimeout(handle);
							}
						} catch (error) {
							/* 忽略 */
						}
						for (let i = 0; i < links.length; i++) {
							try {
								if (links[i].parentNode !== null) links[i].parentNode.removeChild(links[i]);
							} catch (error) {
								/* 忽略 */
							}
						}
						links.length = 0;
					};
				},
			};
		}

		//#endregion

		//#region collapse motion

		/**
		 * Collapse motion for the shell's disclosures.
		 *
		 * The primitive renders a disclosure's body as `open && children`, so when it closes
		 * the node leaves the DOM in the same commit as the state flip: there is nothing left
		 * for CSS to animate, and the panel snaps shut. CSS cannot fix that; the only
		 * instrument left is to freeze the box *before* the state changes and let it shrink
		 * afterwards.
		 *
		 * Strictly bounded, and self-healing by construction:
		 *
		 *  - it runs only on a click that is about to CLOSE an open disclosure, and only while
		 *    the Miracle look is on and the user has not asked for reduced motion;
		 *  - it writes `height`, `overflow` and `transition` on ONE element for the length of
		 *    one animation and then removes all three;
		 *  - a timer always clears them — never `transitionend` alone, which a cancelled or
		 *    unseen transition would never deliver — and any leftover is also cleared at the
		 *    start of the next toggle and on dispose. The worst case is therefore a stale
		 *    height that the very next interaction removes, not a permanently wrong row;
		 *  - it never calls `preventDefault` or `stopPropagation`, so the disclosure's own
		 *    handler runs exactly as shipped.
		 *
		 * Capture phase on purpose: the freeze must be measured before React commits the
		 * removal, and capture runs before the row's own handler regardless of what that
		 * handler does with propagation.
		 *
		 * @param runtime - the viewport runtime (gates the Miracle look).
		 * @returns `{ start }`, whose return value removes the listener and restores any
		 *   element it is holding.
		 */
		function createCollapseMotion(runtime) {
			/** Elements currently frozen, with their pending timer. */
			const frozen = new Map();
			let listener = null;

			const release = (root) => {
				const pending = frozen.get(root);
				if (pending !== undefined) {
					try {
						window.clearTimeout(pending);
					} catch (error) {
						/* 忽略 */
					}
					frozen.delete(root);
				}
				try {
					root.style.height = "";
					root.style.overflow = "";
					root.style.transition = "";
					root.removeAttribute("data-dshas-closing");
					root.style.removeProperty("--dshas-freeze");
				} catch (error) {
					/* 忽略 */
				}
			};

			const reduced = () => {
				const query = mql("(prefers-reduced-motion: reduce)");
				return query !== null && query.matches;
			};

			/** Read a motion token's milliseconds, falling back to the shipped step. */
			const motionMs = (name, fallback) => {
				try {
					const raw = window.getComputedStyle(document.body).getPropertyValue(name).trim();
					const value = parseFloat(raw);
					return isFinite(value) && value > 0 ? value : fallback;
				} catch (error) {
					return fallback;
				}
			};

			/** Read a motion token's easing, falling back to the shipped curve. */
			const motionCurve = (name, fallback) => {
				try {
					const raw = window.getComputedStyle(document.body).getPropertyValue(name).trim();
					return raw === "" ? fallback : raw;
				} catch (error) {
					return fallback;
				}
			};

			/** Evaluate a `cubic-bezier(a,b,c,d)` token at x, so the curve keeps one source. */
			const bezierAt = (token, x) => {
				const numbers = String(token).match(/-?\d*\.?\d+/g);
				if (numbers === null || numbers.length < 4) return x;
				const [x1, y1, x2, y2] = numbers.slice(0, 4).map(Number);
				const at = (t, a, b) => {
					const u = 1 - t;
					return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
				};
				let low = 0;
				let high = 1;
				let t = x;
				for (let i = 0; i < 24; i++) {
					const current = at(t, x1, x2);
					if (Math.abs(current - x) < 1e-5) break;
					if (current < x) low = t;
					else high = t;
					const next = (low + high) / 2;
					if (next === t) break;
					t = next;
				}
				// Clamp the ends explicitly: an early frame must never jump to the target, which is
				// exactly what a solver that overshoots at tiny x produced (one frame of the final
				// height before the ramp began).
				const eased = at(t, y1, y2);
				return eased < 0 ? 0 : eased > 1 ? 1 : eased;
			};

			/**
			 * Drive a box's height frame by frame.
			 *
			 * Everything declarative was tried and measured on a live page: a transition armed in
			 * the same task, a transition armed a frame later with the freeze held by a rule, and a
			 * Web Animations call. In all three the animation reported itself as running — with the
			 * correct property, duration and tokens — while the box still landed on its final height
			 * in the first frame. Writing the height on each frame does not depend on any of that
			 * bookkeeping, and the easing still comes from the named curve token.
			 *
			 * The freeze attribute is kept for the whole run so nothing else can move the box, and a
			 * timer finishes the job even if frames stop arriving.
			 *
			 * @param element - the box to resize.
			 * @param from - the height to start at.
			 * @param to - the height to end at.
			 * @param curveToken - the name of the easing token to follow.
			 * @param done - called when the box is released.
			 */
			const tweenHeight = (element, from, to, curveToken, done) => {
				const duration = motionMs("--dshas-motion-unfold", 420);
				const curve = motionCurve(curveToken, "cubic-bezier(.4,0,1,1)");
				const started = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
				const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
				const frame = () => {
					try {
						const progress = Math.min(1, (now() - started) / duration);
						const eased = bezierAt(curve, progress);
						element.style.height = (from + (to - from) * eased).toFixed(1) + "px";
						if (progress < 1) {
							if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(frame);
							else window.setTimeout(frame, 16);
							return;
						}
					} catch (error) {
						/* 落到收尾 */
					}
					done();
				};
				const begin = () => {
					if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(frame);
					else window.setTimeout(frame, 16);
				};
				// One frame of grace so the frozen height is committed and painted before the first
				// tweened value lands.
				if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(begin);
				else window.setTimeout(begin, 16);
			};

			/**
			 * Close a box by height.
			 *
			 * @param element - the box to close.
			 * @param total - its height right now.
			 * @param target - the height it must end at.
			 */
			const collapseHeight = (element, total, target) => {
				try {
					element.style.overflow = "hidden";
					element.style.height = total + "px";
					element.setAttribute("data-dshas-closing", "1");
					const done = () => {
						try {
							element.removeAttribute("data-dshas-closing");
							element.style.removeProperty("--dshas-freeze");
							element.style.overflow = "";
							element.style.height = "";
						} catch (error) {
							/* 忽略 */
						}
						frozen.delete(element);
					};
					tweenHeight(element, total, target, "--dshas-motion-exit", done);
					frozen.set(element, window.setTimeout(done, 900));
					return true;
				} catch (error) {
					return false;
				}
			};

			/**
			 * Push an element's height from where it is to where its content now wants it.
			 *
			 * This exists for the one kind of panel CSS cannot unfold by itself: a command
			 * block shows a capped number of lines and then all of them, so both states are
			 * `height: auto` with different content and no transition can interpolate
			 * between them. The target height is therefore measured — momentarily at
			 * `auto`, inside the same frame and before any paint, so the freeze is never
			 * visible — and then animated on the named curve.
			 *
			 * @param element - the block whose height is changing.
			 * @param curve - the motion token to run it on.
			 */
			const pushHeight = (element, curve) => {
				const before = element.getBoundingClientRect().height;
				if (!(before > 0)) return;
				element.style.transition = "none";
				element.style.overflow = "hidden";
				element.style.height = before + "px";
				window.requestAnimationFrame(() => {
					try {
						element.style.transition = "none";
						element.style.height = "auto";
						const after = element.getBoundingClientRect().height;
						// Restore the frozen start and FORCE a reflow before arming the transition.
						// Without this the browser resolves the style in one pass, so the start value
						// it sees is already the target and the transition has nothing to run: the
						// panel simply snapped, which is exactly what kept being reported.
						element.style.height = before + "px";
						element.style.transition = "none";
						void element.offsetHeight;
						if (!(after > 0) || Math.abs(after - before) < 1) {
							release(element);
							return;
						}
						element.style.overflow = "hidden";
						element.style.height = before + "px";
						tweenHeight(element, before, after, curve, () => release(element));
						frozen.set(element, window.setTimeout(() => release(element), 900));						element.style.height = after + "px";
					} catch (error) {
						release(element);
					}
				});
				frozen.set(
					element,
					window.setTimeout(() => release(element), 520),
				);
			};

			const onDocumentClick = (event) => {
				try {
					const state = runtime.get();
					if (!state.enabled || (state.miracle !== true && state.motion !== true)) return;
					if (reduced()) return;
					const target = event === null || event === undefined ? null : event.target;
					if (target === null || typeof target.closest !== "function") return;
					// One path for every expandable in the transcript. The host whose height is
					// about to change is either the command sample itself (a bash block shows a
					// capped number of lines and then all of them) or the disclosure root that
					// holds the row and its body. `aria-expanded` reports the state BEFORE the
					// click, so it also picks the direction's curve.
					const control = target.closest("[data-expandable]");
					if (control === null) return;
					// The box that gets frozen is the SURFACE, not the disclosure's inner root. The
					// inner root's inline height was ignored while the row was closing — measured
					// repeatedly, with no animation and no competing height rule to explain it — and
					// the surface is the element whose height the user actually watches change, and
					// the one that survives the collapse. Clipping it and shrinking it is therefore
					// both correct and immune to whatever the internals do.
					const sample = control.closest("[data-sample]");
					const card = control.closest('[data-variant="think"],[data-tool]');
					let host = null;
					if (sample !== null) host = sample.parentElement;
					else if (card !== null) host = card;
					else {
						const row = control.closest("[data-disclosure-row]");
						host = row === null ? null : row.parentElement;
					}
					if (host === null || typeof host.getBoundingClientRect !== "function") return;
					release(host);
					const expandedNow = control.getAttribute("aria-expanded") === "true";
					const curve = expandedNow ? "var(--dshas-motion-exit)" : "var(--dshas-motion-enter)";
					if (expandedNow) {
						// CLOSING: the target height is already known — it is the header row itself,
						// because the body is about to be unmounted. Everything therefore happens
						// synchronously in this listener, before React commits: freeze the current
						// height, force it to be the committed start, then transition to the row's
						// height. Waiting for a frame here is what made the close a cut: the frame
						// could land before the commit, measure no change, and drop the freeze.
						const total = host.getBoundingClientRect().height;
						// The end height: whatever the surface measures once the internals have
						// already collapsed. It is taken by briefly removing the clip in the same
						// frame (never painted), so the target is real rather than guessed.
						const keepHeight = host.style.height;
						host.style.height = "auto";
						host.style.overflow = "";
						const settled = host.getBoundingClientRect().height;
						host.style.height = keepHeight;
						const target = Math.round(Math.min(total, settled > 0 ? settled : total));
						if (total > target && collapseHeight(host, Math.round(total), target)) return;
					}
					// Opening measures the collapsed height and grows to the new one; closing
					// measures the body before it goes, because the primitive unmounts it in the
					// same commit. Both are the same push.
					pushHeight(host, curve);

				} catch (error) {
					/* 一次失败只是回到出厂的硬切 */
				}
			};

			return {
				start() {
					listener = onDocumentClick;
					document.addEventListener("click", listener, true);
					return () => {
						try {
							document.removeEventListener("click", listener, true);
						} catch (error) {
							/* 忽略 */
						}
						listener = null;
						frozen.forEach((timer, root) => release(root));
						frozen.clear();
					};
				},
			};
		}

		//#endregion

		//#region document-level foundations

		/**
		 * Widen the document viewport declaration.
		 *
		 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero on a
		 * notched device; `interactive-widget=resizes-content` keeps the composer
		 * above the software keyboard instead of letting the keyboard overlay it.
		 * `maximum-scale` / `user-scalable` are dropped: pinch-zoom is an
		 * accessibility affordance and the shipped document never asked for them.
		 *
		 * This is the plugin's only write outside `<html>`'s attributes, and it is
		 * restored verbatim on dispose.
		 *
		 * @returns a disposer restoring the original `content`.
		 */
		function patchViewportMeta() {
			let meta = null;
			let before = "";
			try {
				meta = document.querySelector('meta[name="viewport"]');
				if (meta === null) return () => {};
				before = meta.getAttribute("content") || "";
				const kept = [];
				const parts = before.split(",");
				for (let i = 0; i < parts.length; i++) {
					const token = parts[i].trim();
					if (token.length === 0) continue;
					const name = token.split("=")[0].trim().toLowerCase();
					if (name === "maximum-scale" || name === "user-scalable") continue;
					kept.push(token);
				}
				const has = (name) => kept.some((token) => token.split("=")[0].trim().toLowerCase() === name);
				if (!has("width")) kept.unshift("width=device-width");
				if (!has("initial-scale")) kept.push("initial-scale=1");
				if (!has("viewport-fit")) kept.push("viewport-fit=cover");
				if (!has("interactive-widget")) kept.push("interactive-widget=resizes-content");
				meta.setAttribute("content", kept.join(", "));
			} catch (error) {
				console.warn("[" + PKG + "] could not widen the viewport declaration:", error);
				return () => {};
			}
			return () => {
				try {
					if (meta !== null) meta.setAttribute("content", before);
				} catch (error) {
					/* 忽略 */
				}
			};
		}

		//#endregion

		//#region stylesheet

		/**
		 * The stylesheet.
		 *
		 * Three invariants hold for every entry, and `test/smoke.mjs` asserts all
		 * three:
		 *
		 *  1. A rule may only restyle a shipped element behind a gate
		 *     (`data-dsh-adaptive-form` / `-narrow` / `-density` / `-touch` /
		 *     `-compat`). With no marks present the shipped interface is untouched.
		 *  2. No rule may give an ancestor of the composer a containing block or
		 *     paint effect (`transform`, `filter`, `contain`, `will-change`, ...):
		 *     the reasoning-effort card is `position:fixed` and would lose its anchor.
		 *  3. **No rule positions anything.** There is no overlay, no absolutely
		 *     placed element and no `pointer-events` declaration anywhere: the plugin
		 *     cannot cover a click or swallow a touch scroll even if some state goes
		 *     wrong, because it owns no element that could.
		 */
		const CSS = [
			// --- composer geometry -------------------------------------------------
			// The shipped composer reads its own custom properties on the very element
			// that consumes them, so overriding them there is the one place that is
			// guaranteed to win without touching a module-hash class name. Narrow-only:
			// a desktop-class window keeps the shipped 16px gutter.
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] div:has(> [data-composer-card]){--dsh-composer-side-clearance:8px;--dsh-composer-dock-inset:6px;padding-left:calc(8px + env(safe-area-inset-left));padding-right:calc(8px + env(safe-area-inset-right));padding-bottom:calc(4px + env(safe-area-inset-bottom))}',

			// --- the motion scale (one named block, referenced everywhere else) --------
			// Miracle's discipline: a handful of named steps, all declared in one place, and
			// never a constant written at the point of use. `enter` decelerates into place,
			// `exit` accelerates away; both directions of a swap share ONE duration, so the
			// two views cannot tear apart at the seam (personality comes from the curve, not
			// from the clock). `--dshas-drawer` is the single source of the drawer width, so
			// the drawer and the conversation travel exactly the same distance.
			// These tokens are declared on `body`, NOT on `html`: the application's palette
			// (`--dsw-alias-*`) is defined on `body`, and a custom property resolves its own
			// `var()` references where it is DECLARED. Declared on `html` it would compute to the
			// guaranteed-invalid value, inherit that emptiness down to every card, and make
			// `background`/`border` silently invalid — which is exactly why the transcript cards
			// kept vanishing while rules using literal values (the drawer, the settings sheet)
			// worked fine.
			//
			// ONE definition of the transcript card. Every in-flow surface in the conversation —
			// the thinking band, a command block, a tool row, the folded process group — reads
			// these three tokens, so the scheme is changed in exactly one place. The fill is the
			// application's own raised layer rather than an invented tone, which is what makes a
			// card read as part of the page instead of a patch of a different colour.
			"html[data-dsh-adaptive] body{--dshas-motion-enter:cubic-bezier(0,0,.2,1);--dshas-motion-exit:cubic-bezier(.4,0,1,1);--dshas-motion-drawer:260ms;--dshas-motion-press:120ms;--dshas-motion-unfold:420ms;--dshas-build:" + BUILD + "-css;--dshas-card-surface:var(--dsw-alias-bg-layer-1);--dshas-card-hairline:color-mix(in srgb, var(--dsw-alias-label-tertiary) 34%, transparent);--dshas-card-radius:var(--dsw-radius-md)}",

			// --- the sidebar on a narrow phone ---------------------------------------
			// The frame's sidebar column is the one structural thing this plugin touches, for
			// three concrete reasons: the collapsed 56px rail spends ~14% of a 390px screen on
			// empty space; the expanded sidebar *squeezes* the conversation, reflowing the
			// whole transcript every time it opens; and the shell animates that squeeze by
			// changing layout (width), which is the janky, badly-timed motion this replaces.
			//
			// So on a narrow phone the sidebar column never owns a grid track:
			//
			//   1. the track is always 0, in both states, so the conversation keeps the frame's
			//        full width and its original layout, scale and resolution either way;
			//   2. collapsed: the column is parked one drawer-width off the left edge, hidden;
			//   3. expanded: it keeps its place in the grid and overflows its own zero-width
			//        track instead (NOT `position:absolute` — taking a frame child out of flow
			//        shifts grid auto-placement, which lands the centre column in track 1, the
			//        zeroed one, and blanks the conversation);
			//   4. both the drawer and the conversation move with `transform` only, over the
			//        same duration and matching curve tokens, so they stay locked together and
			//        the work stays on the compositor;
			//   5. every box property (position, width, stacking, shadow) is declared ONCE,
			//        outside the two state rules, so flipping the state changes nothing but the
			//        transform. A box that differs between the two states settles after the
			//        slide, which reads as the panel "correcting itself" once it has arrived;
			//        `will-change:transform` keeps the layer alive across the flip so the first
			//        animated frame is not painted at the destination.
			//
			// The exit's `visibility` is delayed by exactly one drawer duration: the panel
			// stays visible while it slides away, then leaves the accessibility tree.
			// The shell's own competing transitions inside the sidebar are suppressed so a
			// single timeline owns the motion.
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]){grid-template-columns:0 minmax(0,1fr) 0 !important;--dshas-drawer:min(280px, 100vw)}',
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]) > :first-child{position:relative;z-index:40;width:var(--dshas-drawer);box-shadow:var(--dsw-elevation-prominent);will-change:transform}',
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]) > :first-child > *{transition:none}',
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]) > [data-side]{display:none}',

			// The shell's own sidebar toggle, hidden on a narrow phone because the
			// conversation header carries the single control for both states. It has no
			// stable attribute of its own — only a build-generated hash class — so it is
			// addressed by where it sits: inside the sidebar column, the LAST direct button
			// of the chrome row (`[data-window-drag]` is the shell's own marker). The first
			// direct button in that row is the brand / new-session control and is never
			// touched; if the shell ever restructures the row, this simply stops matching and
			// the shell's button comes back — a degraded look, never a broken control.
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]) > :first-child [data-window-drag] > button:last-child{display:none}',

			// collapsed: parked off the left edge, conversation at rest
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay])[data-sidebar-collapsed] > :first-child{visibility:hidden;transform:translateX(calc(-1 * var(--dshas-drawer)));transition:transform var(--dshas-motion-drawer) var(--dshas-motion-exit),visibility 0s linear var(--dshas-motion-drawer)}',
			'html[data-dsh-adaptive-push="1"][data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay])[data-sidebar-collapsed] > :nth-child(2){transform:translateX(0);transition:transform var(--dshas-motion-drawer) var(--dshas-motion-exit)}',

			// expanded: the drawer slides in and pushes the conversation by exactly its own
			// width, on the same duration, decelerating into place. Nothing is resized, so
			// the transcript never rewraps.
			//
			// The push is the one place where the reasoning-effort compatibility contract has
			// to bend, and it is gated on `data-dsh-adaptive-push` for that reason: a
			// `transform` on the conversation column makes that column the containing block
			// for `position:fixed` descendants, so while the drawer is open a third-party
			// viewport-fixed overlay inside the conversation (the effort card) is offset by
			// one drawer width. Turning the switch off keeps the drawer's motion and leaves
			// the conversation still.
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]):not([data-sidebar-collapsed]) > :first-child{transform:translateX(0);transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter)}',
			'html[data-dsh-adaptive-push="1"][data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-shell-overlay]):not([data-sidebar-collapsed]) > :nth-child(2){transform:translateX(var(--dshas-drawer));transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter)}',

			// --- reduced motion ----------------------------------------------------
			// Miracle: a decoration that cannot run must degrade to an instant state change,
			// never to a half-applied one. Everything above is a pure transition between two
			// CSS states, so switching it off lands on the correct end state immediately.
			"@media (prefers-reduced-motion: reduce){html[data-dsh-adaptive-motion=\"1\"][data-dsh-adaptive-panel=\"conversation\"][data-dsh-adaptive-narrow=\"1\"][data-dsh-adaptive-form=\"phone\"] :has(> [data-shell-overlay]) > :first-child,html[data-dsh-adaptive-motion=\"1\"][data-dsh-adaptive-panel=\"conversation\"][data-dsh-adaptive-narrow=\"1\"][data-dsh-adaptive-form=\"phone\"] :has(> [data-shell-overlay]) > :nth-child(2){transition:none}}",

			// --- conversation header ---------------------------------------------
			// The shell reserves no room for a notch or the home indicator; this adds
			// those insets and, on a short viewport, gives the height back to content.
			'html[data-dsh-adaptive-motion="1"][data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] :has(> [data-conversation-header-leading]){min-height:0;padding-top:calc(8px + env(safe-area-inset-top));padding-right:calc(12px + env(safe-area-inset-right));padding-bottom:6px;padding-left:calc(12px + env(safe-area-inset-left))}',
			'html[data-dsh-adaptive-panel="conversation"][data-dsh-adaptive-narrow="1"][data-dsh-adaptive-density="compact"] :has(> [data-conversation-header-leading]){min-height:0;padding-top:calc(4px + env(safe-area-inset-top));padding-bottom:4px}',

			// --- touch ergonomics -------------------------------------------------
			// Coarse pointer only, so a mouse never sees a different control size. These
			// three regions carry stable data attributes.
			'html[data-dsh-adaptive-touch="1"] [data-composer-card] button,html[data-dsh-adaptive-touch="1"] [data-conversation-header-leading] button,html[data-dsh-adaptive-touch="1"] [data-sidebar-right-panel] button{min-width:36px;min-height:36px}',

			// --- reasoning-effort compatibility -----------------------------------
			// `dsh-codex-efforting` positions a fixed 340px card by measuring its
			// trigger; below ~364px of viewport width the card cannot fit and its own
			// clamp overflows. A `max-width` (not a `width`) is the smallest possible
			// correction: its rail and knob are percentage-positioned, so the card
			// re-lays out correctly. Gated on the compat preference.
			'html[data-dsh-adaptive-compat="1"][data-dsh-adaptive-form="phone"] .efs-card{max-width:calc(100vw - 24px)}',

			// --- the sidebar toggle in the conversation header ----------------------
			// The plugin's own element: it only exists on a narrow phone, where the rail
			// it replaces has been removed. Normal flow, no positioning — it takes part in
			// the header's layout like any other control there.
			"html[data-dsh-adaptive] [data-dsh-adaptive-nav]{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;flex:none;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;touch-action:manipulation;transition:transform var(--dshas-motion-press) var(--dshas-motion-enter)}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-nav]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-nav]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
			// Press feedback is a geometric change (scale), never a colour fade, and it runs
			// on the named press step.
			"html[data-dsh-adaptive] [data-dsh-adaptive-nav]:active,html[data-dsh-adaptive] [data-dsh-adaptive-nav][data-dsh-adaptive-pressed=\"1\"]{transform:scale(.94)}",

			// --- the transcript card: one scheme, one place --------------------------
			// Thinking, command blocks, tool rows and the folded process group all take the same
			// surface, radius and hairline, defined once above. Three separate recipes were what
			// made the thinking look like it belonged to a different design than the command
			// block next to it.
			//
			// Captions and markers are the shell's own (`data-variant="think"` on a thinking row, `data-sample="bash"` on a command,
			// `data-tool`, `data-chat-flow-kind`); nothing here depends on a build-generated class
			// name, so a rename degrades to "no card", never to a broken layout.
			//
			// The group's card is conditioned on there being no VISIBLE reasoning part, and — the
			// defect this pins — on the group actually having something in it. A process group
			// exists from the moment a turn starts, before its members mount, and its slot wrapper
			// is `:empty` until then; without this second condition the plugin painted an empty
			// bordered box above every new message. The test is the shell's own convention, the
			// same `[data-slot="conversation.chat.node"]:empty` its stylesheet uses.
			//
			// The group's card is conditioned on there being no VISIBLE reasoning part, not on
			// there being none at all: a folded turn keeps its reasoning members in the DOM with
			// `data-turn-process-hidden`, so a plain `:has(reasoning)` stayed true and the folded
			// card silently lost its border. Reading the shell's own hide marker is what makes a
			// live turn (band inside) and a folded turn (one card) two shapes of the same scheme.
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"],html[data-dsh-adaptive-miracle="1"] :has(> [data-sample="bash"]),html[data-dsh-adaptive-miracle="1"] [data-tool],html[data-dsh-adaptive-miracle="1"] [data-chat-flow-kind="turn-process"]:not(:has([data-chat-group-part="reasoning"]:not([data-turn-process-hidden]))):not(:has(> [data-slot="conversation.chat.node"]:empty)){background:var(--dshas-card-surface);border:1px solid var(--dshas-card-hairline);border-radius:var(--dshas-card-radius)}',
			// Padding is the only thing that scales with nesting: an inner row sits tighter than
			// the band that holds it.
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"],html[data-dsh-adaptive-miracle="1"] :has(> [data-sample="bash"]),html[data-dsh-adaptive-miracle="1"] [data-tool]{padding:6px 10px}',
			'html[data-dsh-adaptive-miracle="1"] [data-chat-flow-kind="turn-process"]:not(:has([data-chat-group-part="reasoning"]:not([data-turn-process-hidden]))):not(:has(> [data-slot="conversation.chat.node"]:empty)){padding:8px 12px}',
			// The closing box, driven from the script: the attribute freezes the height, the custom
			// property carries which height, and CSS owns the interpolation.
						// The freeze rules that used to live here are gone. They carried
			// `height: var(--dshas-freeze)` while nothing writes that property any more, and an
			// undefined custom property makes the whole declaration invalid at computed-value
			// time — measured on a live page, that is exactly what stopped an inline height from
			// sizing the box even though the tween was writing it frame by frame. The tween now
			// owns both the height and the clipping inline, and this section keeps only the note.
			//
			// The `[data-open]` half is the whole defect: the grid rule that opens a disclosure is
			// written twice — with and without `[data-open]` — and the `[data-open]` form ties on
			// specificity with the closing rule while sitting LATER in the sheet, so it won the
			// single `transition` property outright and the box had no height transition at all.
			// Matching that same structure here makes this rule strictly higher, and it declares
			// both transitions so opening and closing stay on one timeline.
			//
			// Specificity matters here and was the whole defect: this rule and the grid-track rule
			// tie on specificity, and `transition` is ONE property, so whichever comes later in the
			// sheet wins outright. The grid rule comes later, so the box carried a
			// `grid-template-rows` transition and NO height transition at all — the frozen height
			// was set correctly and then dropped in a single step. Reaching the element through
			// `[data-disclosure-row]` outranks the grid rule, and both transitions are declared
			// together so opening and closing stay on the same timeline.

			// Any frozen box gets a height transition, not only a disclosure root. A command
			// sample is its own host and matches no disclosure rule, so its collapse had no
			// transition at all.
			// Inside a card, the disclosure's own row and root must not paint a surface of their
			// own: an expanded thinking row was showing the PAGE colour on its title line while the
			// card around it was the card colour, so the two halves of one block disagreed.
						// A thinking row that is open turns its own title line into a STICKY header painted
			// with the page colour, so the body scrolls underneath it — that is the shell's
			// design, and its selector (`.root[data-expanded] [data-open] [data-disclosure-row]`)
			// outranks a shorter one, which is why an earlier attempt to force it transparent lost
			// and the title kept reading as a different colour from the card around it.
			//
			// The bar stays opaque and stays sticky; it is painted with the card's own surface
			// instead of the page's, so one block reads as one surface while the body still
			// scrolls under a clean edge. The selector below matches that structure and outranks
			// it, and nothing else about the row is touched.
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"][data-expanded] [data-open] [data-disclosure-row]{background:var(--dshas-card-surface)}',
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"] [data-disclosure-row],html[data-dsh-adaptive-miracle="1"] [data-variant="think"] [data-open]{background-color:transparent}',

			// The command block's shipped card is paper-coloured with a 7%-alpha border, so it is
			// invisible by design. Its class is build-generated, but the card is exactly the
			// element that CONTAINS the sample, which is a stable relationship. The inner row
			// therefore drops its own box, leaving one border rather than two.
			'html[data-dsh-adaptive-miracle="1"] [data-sample="bash"]{background:none;border:0;padding:0}',

			// The detail bodies were the last holdout: each shipped body carries its own recipe
			// (`radius-lg`, a 0.5px border at 7% alpha, a paper- or code-coloured fill, 16/20
			// padding), so an expanded tool call looked nothing like the thinking row or the row
			// that opened it. None of them has a stable class name, but each is identified by a
			// marker the shell itself publishes — and the card is the element that directly wraps
			// that marker. Both the wrapper and the marker therefore take the same tokens as every
			// other card, which is what "one scheme" has to mean.
			//
			// The direct-child form is deliberate: a descendant form would also match the row and
			// every level above it and stack borders. If a body ever nests its marker deeper, the
			// rule simply stops matching that one and the shipped look returns.
			'html[data-dsh-adaptive-miracle="1"] [data-tool] :has(> [data-sample]),html[data-dsh-adaptive-miracle="1"] [data-tool] :has(> [data-diff]),html[data-dsh-adaptive-miracle="1"] [data-tool] :has(> [data-code-block]),html[data-dsh-adaptive-miracle="1"] [data-tool] :has(> [data-terminal]){background:var(--dshas-card-surface);border:1px solid var(--dshas-card-hairline);border-radius:var(--dshas-card-radius);padding:6px 10px}',
			'html[data-dsh-adaptive-miracle="1"] [data-tool] [data-diff],html[data-dsh-adaptive-miracle="1"] [data-tool] [data-code-block],html[data-dsh-adaptive-miracle="1"] [data-tool] [data-terminal]{background:none;border:0;padding:0}',

			// A run of reasoning is ONE band rather than a card per block: consecutive parts lose
			// the flow gap and the radius they share, so the surface reads continuous.
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"] + [data-variant="think"]{margin-top:-1px;border-top-width:0;border-top-left-radius:0;border-top-right-radius:0}',
			'html[data-dsh-adaptive-miracle="1"] [data-variant="think"]:has(+ [data-variant="think"]){border-bottom-width:0;border-bottom-left-radius:0;border-bottom-right-radius:0}',
			// Work in progress is the one state that earns the brand colour, and both kinds of
			// running row get it through the same declaration.
			'html[data-dsh-adaptive-miracle="1"] [data-sample="bash"][data-state="running"],html[data-dsh-adaptive-miracle="1"] [data-tool][data-state="running"],html[data-dsh-adaptive-miracle="1"] [data-variant="think"][data-state="running"]{border-color:var(--dsw-alias-brand-primary)}',

			// --- the disclosure unfold -----------------------------------------------
			// Every expandable row in the transcript — tool calls, compaction notices, file
			// changes — uses the shell's `DisclosureRow`, whose body is rendered as
			// `open && children`: the body DOES NOT EXIST while closed. A transition can
			// never animate that, which is why the shell's disclosures snap open and why the
			// transcript felt stiff. The only honest instrument is a mount animation, so this
			// is the plugin's single keyframe rule.
			//
			// `height: 0 -> auto` is interpolatable only where `interpolate-size` is
			// supported, so the rule lives inside that `@supports` block: elsewhere the
			// disclosure keeps the shipped instant behaviour instead of half-animating.
			// `fill-mode: both` applies the zero-height start on the very first frame, so the
			// body cannot flash at full height before the unfold begins.
			//
			// The body is addressed as the open root's last child that is not the row itself,
			// which is exactly what the primitive renders — and the `:has()` guard keeps the
			// rule from ever touching a `data-open` element that is not a disclosure.
			// The mechanism is a two-track grid on the disclosure root: track 1 is the header
			// row, track 2 is the body, and `0fr -> 1fr` is interpolable nearly everywhere.
			// (The first attempt used `interpolate-size: allow-keywords` with a mount
			// keyframe; that property is Chrome 129+, so on anything older the whole
			// animation was skipped by its own @supports guard and the disclosure still
			// snapped. Nothing here depends on a recent feature.)
			//
			// Both states declare the SAME two tracks so the value interpolates, the entrance
			// decelerates and the exit accelerates on one shared duration, and the body is
			// clipped rather than resized while it slides open.
			//
			// Known asymmetry, stated rather than hidden: the shell's primitive renders the
			// body as `open && children`, so on collapse the node is unmounted in the same
			// commit and there is nothing left to animate — the close stays a cut. Making it
			// symmetric needs a change in the primitive (keep the body mounted and animate
			// its track), which is not a plugin's to make.
			'html[data-dsh-adaptive-motion="1"] :has(> [data-disclosure-row]){display:grid;grid-template-rows:auto 0fr;transition:grid-template-rows var(--dshas-motion-unfold) var(--dshas-motion-exit)}',
			'html[data-dsh-adaptive-motion="1"] [data-open]:has(> [data-disclosure-row]){grid-template-rows:auto 1fr;transition:grid-template-rows var(--dshas-motion-unfold) var(--dshas-motion-enter)}',
			'html[data-dsh-adaptive-motion="1"] [data-open]:has(> [data-disclosure-row]) > :last-child:not([data-disclosure-row]){overflow:hidden;min-height:0}',

			// --- the curved expand (entry motion on the pieces that appear) ----------
			// What the user asked for by name: the curved scale-expand. Each of these nodes
			// either mounts when the transcript grows or is the sheet that opens over the
			// conversation, and each one now settles in with a short transform — scale plus a
			// few pixels of displacement, on the named duration and the decelerating curve.
			// Nothing fades, nothing resizes, so the motion stays on the compositor and the
			// text inside never re-lays out.
			//
			// `@starting-style` supplies the pre-entry value for a freshly rendered element,
			// which a plain transition cannot describe. Where it is unsupported the node keeps
			// the shipped instant appearance — a silent degradation, never a broken one.
			//
			// Note the deliberate narrowing: this is displacement, not the single global
			// entrance animation Miracle reserves for the splash. A row that streams into an
			// existing transcript is a later arrival, not the application opening.
			// --- the scale-expand, on the surfaces that are cards rather than rows ----
			// The transcript's rows unfold by height; a card that arrives ON TOP of the
			// conversation is a different gesture and gets the curved scale-expand instead:
			// the right-hand sheet (background jobs, sub-agents, the team list), a floating
			// pane inside it, and any dialog. Each grows from the edge it is anchored to, so
			// the origin sits near what opened it rather than at the card's own centre.
			//
			// The transcript rows deliberately do NOT scale: a row that is part of the flow
			// must move the flow, which is the height unfold, and giving both gestures to the
			// same element is what made the earlier attempt read as noise.
			// Pages animate too, not only sheets. The main panel and the settings sections are
			// rendered fresh when you switch to them, so `@starting-style` is again the only
			// instrument. The main-panel rule deliberately excludes anything containing the
			// conversation: a transform on a subtree that holds the composer would become the
			// containing block for the effort card, which is the one compatibility contract this
			// plugin keeps with it.
			'html[data-dsh-adaptive-motion="1"] [data-slot="main"]:not(:has([data-conversation-scroll])){transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter)}',
			'html[data-dsh-adaptive-motion="1"] [data-slot="settings.section"]{transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter)}',
			'html[data-dsh-adaptive-motion="1"] [data-sidebar-right-panel]{transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter);transform-origin:100% 50%}',
			'html[data-dsh-adaptive-motion="1"] [data-dockkit-float]{transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter);transform-origin:100% 50%}',
			// `dsh-codex-efforting`'s model / effort card already carries `role="dialog"`, so it
			// picks up the scale-expand above. All it needs is its own origin: the card is
			// anchored above the composer, so it grows up out of that corner rather than out of
			// its own middle. Only `transform-origin` is touched — never its colours, its
			// border, its shadow or its layout.
						// Bottom-centre rather than a corner, and that is deliberate: the card computes
			// `left` from its trigger but clamps it to `innerWidth - 340 - 12`, so on a phone it
			// ends up flush with the RIGHT margin while on a wide screen it sits at the trigger's
			// left edge. No single corner is right for both, and the horizontal share of a
			// 0.96 -> 1 scale is only a few pixels, so centring the origin is never visibly wrong.
			'html[data-dsh-adaptive-motion="1"] .efs-card{transform-origin:50% 100%}',
			'html[data-dsh-adaptive-motion="1"] [aria-modal="true"],html[data-dsh-adaptive-motion="1"] [role="dialog"]{transition:transform var(--dshas-motion-drawer) var(--dshas-motion-enter);transform-origin:50% 40%}',
			'@starting-style{html[data-dsh-adaptive-motion="1"] [data-sidebar-right-panel],html[data-dsh-adaptive-motion="1"] [data-dockkit-float],html[data-dsh-adaptive-motion="1"] [aria-modal="true"],html[data-dsh-adaptive-motion="1"] [role="dialog"],html[data-dsh-adaptive-motion="1"] [data-slot="main"]:not(:has([data-conversation-scroll])),html[data-dsh-adaptive-motion="1"] [data-slot="settings.section"]{transform:scale(.97) translateY(-4px)}}',
			'html[data-dsh-adaptive-motion="1"] [data-sidebar-right-panel]:not([data-sidebar-right-open]){transform:translateX(18px) scale(.99)}',

			// Appearance renders its choices as "cubes" in a wrapping flex row, and each cube
			// carries a fixed flex basis — so a set of them wraps onto one line each and reads as
			// a vertical column. The wrapper's class is build-generated, but what identifies it is
			// semantic and stable: it is a container of CHOICES, i.e. three or more sibling
			// buttons. Any such container inside a settings item becomes a three-up grid, which
			// is what "three across" means, and in a grid the cubes\u2019 own flex basis no longer
			// matters. Two-option controls are untouched, and so is everything outside settings.
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-slot="settings.general.item"] :has(> button:nth-child(3)){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-slot="settings.general.item"] :has(> button:nth-child(3)) > button{min-width:0}',
			// --- desktop gets its own additions ---------------------------------------
			// The phone is not the only target: on a pointer device the transcript cards answer the
			// cursor, and on a wide screen the transcript keeps a readable measure instead of
			// stretching a paragraph across 1400px. Both are desktop-only by construction
			// (`hover: hover`) and both are switchable, so a desktop user keeps control.
			//
			// The hover answer is ink, not displacement: the border takes the interactive colour and
			// nothing moves — the rule this project keeps everywhere.
			// Keyboard users get to see where they are. The shell's own focus style is thin on a wide
			// screen, and these rows are interactive (they open and close), so a focus ring that
			// matches the card's corner is a real desktop affordance rather than decoration.
			'@media (hover: hover) and (pointer: fine){html[data-dsh-adaptive] [data-disclosure-row][data-expandable]:focus-visible,html[data-dsh-adaptive] [data-variant="think"]:focus-within,html[data-dsh-adaptive] [data-tool]:focus-within{outline:2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);outline-offset:2px}}',
			'@media (hover: hover) and (pointer: fine){html[data-dsh-adaptive] [data-variant="think"]:hover,html[data-dsh-adaptive] [data-tool]:hover,html[data-dsh-adaptive] [data-chat-flow-kind="turn-process"]:hover{border-color:color-mix(in srgb, var(--dsw-alias-label-tertiary) 72%, transparent)}}',
			// Reading measure: capped and centred, so the eye does not have to travel the width of a
			// monitor and back for every line. Only above 1280px, and only while the preference is on.
			'html[data-dsh-adaptive-wideReading="1"] [data-conversation-scroll] [data-chat-flow-key],html[data-dsh-adaptive-wideReading="1"] [data-conversation-scroll] [data-chat-flow-kind]{max-width:74ch;margin-inline:auto}',
			'html[data-dsh-adaptive-wideReading="1"] [data-conversation-scroll] [data-slot="conversation.composer"],html[data-dsh-adaptive-wideReading="1"] [data-conversation-scroll] div:has(> [data-composer-card]){max-width:74ch;margin-inline:auto}',

			// --- settings on a phone -------------------------------------------------
			// Verified against the panel's own render, not inferred from its stylesheet:
			//
			//   div[data-shortcut-modal="settings"][role=dialog][aria-modal=true]
			//     <nav>                     → [ div (title) , div (list) ]
			//     div.content               → [ div.header , div.options ← the settings.section slot ]
			//
			// The shipped panel is a centered 800px modal capped at `100vw - 48px` with a fixed
			// 188px section column inside a flex row, so on a 390px phone the content column is
			// left with roughly 150px. `data-shortcut-modal` is a purpose-built attribute and the
			// two `>` paths below are the relations that markup actually has, so nothing here
			// depends on a build-generated class name; if the structure changes they stop
			// matching and the shipped layout returns.
			//
			// The panel becomes a full-bleed sheet stacking the section strip above the content,
			// and — the part the previous attempt got wrong — each section cell is pinned to its
			// own width. Without that they shrink inside the row and a Chinese label wraps one
			// character per line, which is exactly the vertical strip that came out of it.
			//
			// Heights stay percentages inside this `inset:0` overlay, so no viewport unit enters
			// the sheet, and the strip scrolls only horizontally so a vertical gesture is never
			// handled there and keeps reaching the panel's own scroller.
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"]{flex-direction:column;width:100%;max-width:100%;height:100%;border-radius:0}',
			// The strip keeps the panel's own title as its first item, and reserves room on the
			// right for the close control so the two never overlap.
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > nav{flex:none;flex-direction:row;align-items:center;gap:8px;width:100%;padding:calc(6px + env(safe-area-inset-top)) calc(52px + env(safe-area-inset-right)) 6px calc(10px + env(safe-area-inset-left));overflow-x:auto;overflow-y:hidden}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > nav > :first-child{flex:none;padding:0 6px}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > nav > :last-child{flex-direction:row;gap:6px;overflow-x:auto;overflow-y:hidden}',
			// Pinned width per cell. Without it they shrink inside the row and a Chinese label
			// wraps one character per line — the vertical strip that came out of the first attempt.
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > nav button{flex:none;height:36px;padding:0 12px}',
			// The close control lives in the content header, so stacking the panel put it below the
			// strip. It is a 28px leaf button in a `position:relative` panel, so lifting it to the
			// panel's top-right corner is the one move that satisfies both requirements: the strip
			// stays on top, and closing stays where the hand expects it. Nothing can be covered by
			// it — the strip reserves exactly this space.
			// The scroll chain. Stacking the panel makes the content column a flex item in a
			// COLUMN axis, where `min-height` defaults to `auto`: it then refuses to shrink below
			// its content, its inner `overflow-y:auto` scroller never receives a bounded height,
			// and the whole sheet becomes unscrollable. `min-height:0` restores the chain
			// panel → content → options, which is the only thing that makes the page scroll.
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child{flex:1;min-height:0}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :first-child{height:auto;padding:6px 14px 0 10px}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :first-child > :last-child{position:absolute;top:calc(6px + env(safe-area-inset-top));right:calc(6px + env(safe-area-inset-right));width:36px;height:36px;justify-content:center}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-shortcut-modal="settings"] > :last-child > :last-child{padding:0 calc(14px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left))}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-slot="settings.section"]{max-width:none;min-width:0}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-slot="settings.general.item"]{min-width:0;max-width:none}',
			'html[data-dsh-adaptive-narrow="1"][data-dsh-adaptive-form="phone"] [data-dsh-adaptive-row]{flex-wrap:wrap;align-items:flex-start;gap:10px}',

			// --- settings rows ----------------------------------------------------
			"html[data-dsh-adaptive] [data-dsh-adaptive-row]{display:flex;align-items:center;gap:16px;padding:14px 0}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-row-text]{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-row-title]{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-row-desc]{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-select]{height:34px;flex:none;padding:0 10px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-switch]{width:20px;height:20px;flex:none;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",
			"html[data-dsh-adaptive] [data-dsh-adaptive-readout]{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;text-align:right;font-variant-numeric:tabular-nums}",
		];

		/**
		 * Install the stylesheet once per page.
		 *
		 * The `data-plugin-css` marker keeps a re-mount from stacking duplicate rules.
		 * Nothing re-appends the tag to win a cascade tie: every rule that can touch a
		 * shipped element is attribute-gated and therefore already outranks the
		 * shipped rules it overrides.
		 *
		 * @returns a disposer removing the tag.
		 */
		function installStyles() {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", PKG);
			tag.setAttribute("data-plugin", PKG);
			tag.textContent = CSS.join("\n");
			document.head.appendChild(tag);
			return () => {
				try {
					if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
				} catch (error) {
					/* 忽略 */
				}
			};
		}

		//#endregion

		//#region Miracle palette

		/**
		 * Miracle's design language, mapped onto the shell's semantic tokens.
		 *
		 * The `miracle-design` methodology calls for one source of truth named by
		 * *role*, not by appearance, and for dark to be its own palette rather than an
		 * inversion. That is exactly what `ctx.theme.overrideTokens` takes: a role ->
		 * `{ light, dark }` map, stacked as a layer over whatever theme is active and
		 * removable in one call. The shipped theme stays untouched, so turning this
		 * off restores it exactly.
		 *
		 * Three Miracle rules are encoded here:
		 *
		 *  - no pure black and no pure white: the page is warm paper, the raised
		 *    surface is a slightly lighter paper, the sunken role is a warm grey;
		 *  - in dark mode the *interactive* colour is brightened (`#7E96F0`), never
		 *    darkened — a deep brand blue is unreadable on a dark ground;
		 *  - shadows carry the ink hue and are near-zero in dark mode, where "surface
		 *    is lighter than page" carries the hierarchy instead.
		 */
		const MIRACLE_TOKENS = {
			// page / raised surface / sunken role
			"--dsw-alias-bg-base": { light: "#FBFAF6", dark: "#12141F" },
			"--dsw-alias-bg-layer-1": { light: "#FFFFFF", dark: "#1B1E2E" },
			"--dsw-alias-bg-layer-2": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-alias-bg-layer-3": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-alias-bg-overlay": { light: "#FFFFFF", dark: "#1B1E2E" },
			"--dsw-alias-bg-module-platform": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-alias-bg-multi-select": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-specific-input-major": { light: "#FFFFFF", dark: "#1B1E2E" },
			"--dsw-specific-sidebar-fill": { light: "#FBFAF6", dark: "#12141F" },
			"--dsw-specific-selector": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-specific-tip": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-specific-bubble": { light: "#EEF1FB", dark: "#242839" },
			"--dsw-specific-bubble-highlight": { light: "#DCE2F8", dark: "#2E3350" },
			"--dsw-specific-menu": { light: "rgb(251 250 246 / 82%)", dark: "rgb(27 30 46 / 80%)" },
			"--dsw-alias-menu-group-header-fill": { light: "rgb(251 250 246 / 94%)", dark: "rgb(27 30 46 / 94%)" },
			"--dsw-alias-markdown-code-block": { light: "#F4F3ED", dark: "#1B1E2E" },
			"--dsw-alias-markdown-code-block-banner": { light: "#EFEDE4", dark: "#171A29" },
			"--dsw-alias-markdown-inline-code": { light: "#F4F3ED", dark: "#242839" },
			"--dsw-alias-markdown-citation": { light: "#F4F3ED", dark: "#2A2E44" },
			"--dsw-alias-markdown-tag": { light: "#F4F3ED", dark: "#2A2E44" },
			"--dsw-alias-markdown-placeholder": { light: "#F4F3ED", dark: "#2A2E44" },
			// ink hierarchy
			"--dsw-alias-label-primary": { light: "#161B38", dark: "#EEF0F8" },
			"--dsw-alias-label-secondary": { light: "#454C70", dark: "#C4C9DD" },
			"--dsw-alias-label-tertiary": { light: "#7B83A6", dark: "#8B92AD" },
			"--dsw-alias-label-caption": { light: "#7B83A6", dark: "#8B92AD" },
			"--dsw-alias-label-dimmed": { light: "#C2C7DA", dark: "#565C78" },
			"--dsw-alias-label-primary-dimmed": { light: "#2C3457", dark: "#DDE1F0" },
			"--dsw-alias-label-primary-bluish": { light: "#25306B", dark: "#E4E8F8" },
			"--dsw-alias-menu-icon": { light: "#2C3457", dark: "#C4C9DD" },
			// brand: blue-purple in light, brightened in dark
			"--dsw-alias-brand-primary": { light: "#5570D8", dark: "#7E96F0" },
			"--dsw-alias-button-primary-fill": { light: "#5570D8", dark: "#7E96F0" },
			"--dsw-alias-button-primary-hover": { light: "#3F58BE", dark: "#93A8F5" },
			"--dsw-alias-link": { light: "#3F58BE", dark: "#8FA5F2" },
			"--dsw-alias-state-business-primary": { light: "#5570D8", dark: "#7E96F0" },
			"--dsw-alias-state-business-tertiary": { light: "#E7EAF9", dark: "#252A45" },
			// hairlines and ink-tinted masks
			"--dsw-alias-border-l1": { light: "#161B3812", dark: "#EEF0F80F" },
			"--dsw-alias-border-l2": { light: "#161B3821", dark: "#EEF0F81F" },
			"--dsw-alias-border-l3": { light: "#161B382B", dark: "#EEF0F829" },
			"--dsw-alias-border-l4": { light: "#161B3838", dark: "#EEF0F833" },
			"--dsw-alias-bg-mask-1": { light: "rgb(22 27 56 / 32%)", dark: "rgb(6 8 18 / 52%)" },
			"--dsw-alias-bg-mask-2": { light: "rgb(22 27 56 / 14%)", dark: "rgb(6 8 18 / 22%)" },
			"--dsw-alias-bg-mask-3": { light: "rgb(22 27 56 / 52%)", dark: "rgb(6 8 18 / 62%)" },
			// soft radii
			"--dsw-radius-sm": { light: "10px", dark: "10px" },
			"--dsw-radius-md": { light: "14px", dark: "14px" },
			"--dsw-radius-lg": { light: "20px", dark: "20px" },
			"--dsw-radius-xl": { light: "24px", dark: "24px" },
			// restrained, ink-hued shadows; near-zero in dark
			"--dsw-shadow-lv1": { light: "0 2px 4px 0 rgb(22 27 56 / 7%)", dark: "none" },
			"--dsw-shadow-lv2": { light: "0 4px 12px 0 rgb(22 27 56 / 5%), 0 2px 8px 0 rgb(22 27 56 / 7%)", dark: "none" },
			"--dsw-shadow-lv3": {
				light: "0 0 1px 0 rgb(22 27 56 / 12%), 0 12px 32px 0 rgb(22 27 56 / 10%)",
				dark: "0 0 1px 0 rgb(255 255 255 / 9%)",
			},
			"--dsw-elevation-stroke-color": { light: "#161B3821", dark: "#EEF0F81F" },
			"--dsw-elevation-stroke": { light: "0 0 0 .5px #161B3821", dark: "0 0 0 .5px #EEF0F81F" },
			"--dsw-elevation-panel": {
				light: "0 0 0 .5px #161B3821, 0 3px 8px 0 rgb(22 27 56 / 6%), 0 0 16px 0 rgb(22 27 56 / 4%)",
				dark: "0 0 0 .5px #EEF0F81F",
			},
			"--dsw-elevation-prominent": {
				light: "0 0 0 .5px #161B3821, 0 6px 20px 0 rgb(22 27 56 / 9%), 0 0 28px 0 rgb(22 27 56 / 6%)",
				dark: "0 0 0 .5px #EEF0F829, 0 8px 24px 0 rgb(0 0 0 / 34%)",
			},
			"--dsw-elevation-soft": {
				light: "0 0 0 .5px #161B3812, 0 4px 16px 0 rgb(22 27 56 / 5%), 0 0 24px 0 rgb(22 27 56 / 5%)",
				dark: "0 0 0 .5px #EEF0F80F",
			},
			// restraint on the glass: menus stay legible paper, not frosted plastic
			"--dsw-menu-backdrop-filter": { light: "blur(18px) saturate(130%)", dark: "blur(18px) saturate(130%)" },
		};

		/**
		 * Apply or retract the Miracle layer as one effect.
		 *
		 * `overrideTokens` keeps one layer per source and replaces it on a second call,
		 * so this only has to create it once and drop it when the preference turns off.
		 *
		 * @param ctx - the plugin's Cordis context.
		 * @param prefs - the preference store.
		 * @returns `{ isApplied, start }`.
		 */
		function createMiracleTheme(ctx, prefs) {
			let layer = null;
			let applied = false;
			const remove = () => {
				applied = false;
				if (layer === null) return;
				const drop = layer;
				layer = null;
				try {
					drop();
				} catch (error) {
					console.warn("[" + PKG + "] dropping the Miracle layer failed:", error);
				}
			};
			const sync = () => {
				const now = prefs.get();
				const want = now.enabled !== false && now.miracle === true;
				if (want && layer === null) {
					try {
						const dispose = ctx.theme.overrideTokens(PKG, MIRACLE_TOKENS);
						layer = typeof dispose === "function" ? dispose : () => {};
						applied = true;
					} catch (error) {
						layer = () => {};
						applied = false;
						console.warn("[" + PKG + "] Miracle token layer refused; keeping the shipped palette:", error);
					}
				} else if (!want) {
					remove();
				}
			};
			return {
				/** Whether the token layer is currently stacked over the active theme. */
				isApplied: () => applied,
				start() {
					const unsubscribe = prefs.subscribe(sync);
					sync();
					return () => {
						unsubscribe();
						remove();
					};
				},
			};
		}

		//#endregion

		//#region locale

		const DICT_ZH = {
			"row.enabled.title": "自适应界面",
			"row.enabled.desc": "按屏幕尺寸与比例匹配手机 / 平板 / 桌面：手机上完全收起 56px 图标栏（入口移到会话页头）、给输入框和页头补安全区（刘海、Home 指示条）、窄屏收紧左右留白、触摸设备放大控件。关闭后立刻回到出厂。",
			"nav.open": "打开侧栏",
			"nav.close": "收起侧栏",
			"row.form.title": "形态覆盖",
			"row.form.desc": "自动判定不合适时，可在这里强制某一档。",
			"row.form.auto": "自动",
			"row.form.phone": "手机",
			"row.form.tablet": "平板",
			"row.form.desktop": "桌面",
			"row.density.title": "紧凑纵向间距",
			"row.density.desc": "屏幕较矮时压缩页头，把高度让给内容（仅窄屏生效）。",
			"row.density.auto": "自动",
			"row.density.on": "始终紧凑",
			"row.density.off": "始终舒适",
			"row.touch.title": "触摸尺寸",
			"row.touch.desc": "在触摸设备上把输入框与工具栏按钮放大到 36px 以上。",
			"row.compat.title": "推理卡片宽度收敛",
			"row.compat.desc": "手机窄屏下把推理等级卡片限制在视口内，避免固定 340px 越界。",
			"row.push.title": "侧栏推开主会话（同步运动）",
			"row.push.desc": "展开侧栏时主会话按同一时长、同一曲线同步右移，位移量等于侧栏宽度，绝不重排正文。代价：展开期间，依赖“固定定位 + 视口坐标”的第三方浮层（如推理卡片）会偏移一个侧栏宽度，装了那类插件时建议关掉本项。",
			"row.miracle.title": "Miracle 视觉",
			"row.miracle.desc": "换成 Miracle 设计语言：暖白纸感底、墨蓝色阶、蓝紫品牌色、柔和圆角、带墨色的克制阴影；暗色是独立配色而不是反色。只叠加令牌层，关掉即逐字还原。",
			"row.wide.title": "宽屏阅读宽度",
			"row.wide.desc": "默认关闭：shell 自己在宽屏已经有合理行宽，这条是给想要更窄、更省眼的人用的（约 74 字符并居中）。手机上无效。",
			"row.readout.title": "当前判定",
			"row.readout.desc": "插件真正读到的数值。第二行是各标记的命中个数，第三行是设置面板的真实元素链（含实测宽度）。都读不到就显示 —，不推测、不编造。",
			"readout.phone": "手机",
			"readout.tablet": "平板",
			"readout.desktop": "桌面",
			"readout.narrow": "窄屏",
			"readout.wide": "宽屏",
			"readout.sidebarOpen": "侧栏展开",
			"readout.sidebarClosed": "侧栏收起",
			"readout.touchOn": "触摸尺寸",
			"readout.touchOff": "鼠标尺寸",
			"readout.theme": "配色",
			"readout.unknown": "—",
			"readout.settingsClosed": "设置未打开",
		};

		const DICT_EN = {
			"row.enabled.title": "Adaptive interface",
			"row.enabled.desc": "Match phone / tablet / desktop by screen size and aspect ratio: on a phone the 56px icon rail collapses completely (its entry point moves to the conversation header), the composer and header gain safe-area insets (notch, home indicator), narrow screens get tighter side gutters and touch devices get larger controls. Turning it off restores the shipped interface immediately.",
			"nav.open": "Open sidebar",
			"nav.close": "Collapse sidebar",
			"row.form.title": "Form factor override",
			"row.form.desc": "Force one form when automatic detection gets it wrong.",
			"row.form.auto": "Automatic",
			"row.form.phone": "Phone",
			"row.form.tablet": "Tablet",
			"row.form.desktop": "Desktop",
			"row.density.title": "Compact vertical rhythm",
			"row.density.desc": "Compress the header on short screens so content keeps the height (narrow layouts only).",
			"row.density.auto": "Automatic",
			"row.density.on": "Always compact",
			"row.density.off": "Always comfortable",
			"row.touch.title": "Touch sizing",
			"row.touch.desc": "Grow composer and toolbar controls past 36px on touch devices.",
			"row.compat.title": "Constrain the effort card",
			"row.compat.desc": "Keep the reasoning-effort card inside the viewport on narrow phones instead of letting its fixed 340px overflow.",
			"row.push.title": "Drawer pushes the conversation",
			"row.push.desc": "Opening the drawer moves the conversation right by exactly the drawer width, on the same duration and curve — nothing is resized, so the transcript never rewraps. Cost: while the drawer is open, a third-party overlay that mixes `position:fixed` with viewport coordinates (the effort card) is offset by one drawer width; turn this off if you use one.",
			"row.miracle.title": "Miracle look",
			"row.miracle.desc": "Switch to the Miracle design language: warm paper ground, ink label ramp, blue-purple brand, soft radii and ink-hued restrained shadows; dark is its own palette rather than an inversion. It is one token layer, so turning it off restores the shipped theme verbatim.",
			"row.wide.title": "Wide-screen reading width",
			"row.wide.desc": "Off by default: the shell already centres a sensible measure on wide screens. Turn this on for a narrower one (about 74 characters). No effect on phones.",
			"row.readout.title": "Detected state",
			"row.readout.desc": "What the plugin actually read. Line 2 counts marker hits; line 3 is the settings panel\u2019s real element chain with measured widths.",
			"readout.phone": "phone",
			"readout.tablet": "tablet",
			"readout.desktop": "desktop",
			"readout.narrow": "narrow",
			"readout.wide": "wide",
			"readout.sidebarOpen": "sidebar open",
			"readout.sidebarClosed": "sidebar collapsed",
			"readout.touchOn": "touch sizing",
			"readout.touchOff": "pointer sizing",
			"readout.theme": "theme",
			"readout.unknown": "—",
			"readout.settingsClosed": "设置未打开",
		};

		//#endregion

		//#region components

		/**
		 * One settings row.
		 *
		 * Built from theme tokens rather than the settings primitives, because a plugin
		 * plain-JS module must not import a Harness Client UI package.
		 */
		/** The sidebar glyph: a rounded frame with the rail column hinted inside it. */
		const PanelGlyph = () =>
			h(
				"svg",
				{ width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true, focusable: false },
				[
					h("rect", {
						key: "frame",
						x: 2,
						y: 3,
						width: 14,
						height: 12,
						rx: 2.5,
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.5,
					}),
					h("path", { key: "rail", d: "M7 3v12", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
				],
			);

		function SettingsRow(props) {
			try {
				return h("div", { "data-dsh-adaptive-row": "" }, [
					h("div", { key: "text", "data-dsh-adaptive-row-text": "" }, [
						h("div", { key: "title", "data-dsh-adaptive-row-title": "" }, props.title),
						h("div", { key: "desc", "data-dsh-adaptive-row-desc": "" }, props.description),
					]),
					props.control,
				]);
			} catch (error) {
				return null;
			}
		}

		//#endregion

		/** Render nothing; publish which main panel is showing so the stylesheet can see it. */
		function PanelStatePublisher(props) {
			try {
				const usePanelInfo = props.usePanelInfo;
				const activeId = typeof usePanelInfo === "function" ? usePanelInfo((info) => info.activePanelId) : undefined;
				React.useEffect(
					() => {
						try {
							const root = document.documentElement;
							if (activeId === null || activeId === undefined) root.setAttribute(A_PANEL, PANEL_CONVERSATION);
							else root.removeAttribute(A_PANEL);
						} catch (error) {
							/* 忽略 */
						}
						return () => {
							try {
								document.documentElement.removeAttribute(A_PANEL);
							} catch (error) {
								/* 忽略 */
							}
						};
					},
					[activeId],
				);
				// It renders nothing at all: no element, no overlay, nothing to cover or capture.
				return null;
			} catch (error) {
				return null;
			}
		}

		//#endregion

		//#region apply

		const INJECT = ["slots", "layout", "locale", "theme"];

		/**
		 * Mount the browser half.
		 *
		 * No exception escapes, and no failure leaves a half-applied state: the
		 * stylesheet is gated on marks the runtime stamps, so if the runtime fails
		 * there is nothing to undo. The only slot this plugin occupies is the
		 * additive `settings.general.item` list.
		 *
		 * @param ctx - the plugin's Cordis context.
		 */
		function apply(ctx) {
			const prefs = createPrefStore();
			const runtime = createRuntime(prefs);

			// The sidebar toggle is the only action this plugin ever calls. Reading the
			// service into a local here means a guarded proxy that refuses the access
			// fails loudly at mount instead of silently at tap time.
			let layout = null;
			try {
				layout = ctx.layout;
			} catch (error) {
				console.warn("[" + PKG + "] layout service unavailable; the sidebar toggle will be omitted:", error);
			}

			let translate = (key) => key;
			try {
				ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), PKG + ": dictionaries");
			} catch (error) {
				/* 热替换后同一 ns+locale 可能已被上一份模块注册过；下面的 bind 仍能找到它 */
			}
			try {
				const bound = ctx.locale.bind(NS);
				translate = (key) => {
					try {
						const value = bound(key);
						return typeof value === "string" && value.length > 0 ? value : key;
					} catch (error) {
						return key;
					}
				};
			} catch (error) {
				console.warn("[" + PKG + "] locale service unavailable; falling back to key names:", error);
			}
			const t = (key) => translate(key);

			try {
				ctx.effect(installStyles, PKG + ": stylesheet");
			} catch (error) {
				console.warn("[" + PKG + "] stylesheet install failed; keeping the shipped look:", error);
			}
			try {
				ctx.effect(patchViewportMeta, PKG + ": viewport declaration");
			} catch (error) {
				console.warn("[" + PKG + "] viewport declaration patch failed:", error);
			}
			try {
				ctx.effect(() => {
					runtime.start();
					return () => runtime.stop();
				}, PKG + ": runtime");
			} catch (error) {
				console.warn("[" + PKG + "] runtime failed; the interface stays as shipped:", error);
			}
			// DISABLED, deliberately and with the measurements written down.
			//
			// The first defect is fixed: an edit had deleted `motionMs`/`motionCurve`, so the tween
			// threw on its first line, the catch released the freeze at once, and every disclosure
			// snapped and briefly lost its box. With the readers back the tween runs and writes a
			// correct ramp (846 -> 825 -> 790 -> ... measured frame by frame).
			//
			// What is NOT solved: on a CLOSING disclosure the box ignores that inline height. The
			// same inline height resizes the same element correctly while the disclosure is open
			// (setting 500px took the chain 846/860/860/860 -> 500/514/514/514), so the conflict is
			// specific to the closing state and is not yet understood. Rather than ship a mechanism
			// that cannot be proven on a real page, the shim stays off: opening is animated by the
			// stylesheet alone, which is verified, and closing keeps the shell's own cut.
			// DISABLED for good reason, and the reason is architectural rather than a bug to chase.
			//
			// Animating a height means owning the box, and owning the box means owning the clip: the
			// freeze needs `overflow:hidden` plus a fixed height for the length of the animation, and
			// every way that can go wrong is a VISIBLE defect — content showing before the box opens,
			// or a region of the card cut away. That is exactly what came back from the device
			// ("thinking content renders before the expand, and the show/occlude region is wrong").
			//
			// Trading the shell's clip for 420ms of motion is not a good trade, so this stays off.
			// What was learned is kept: the inner disclosure root ignores an inline height while it
			// closes, while the surface card honours it, and the frame-driven tween produces a clean
			// ramp (874 -> 802 -> 724 -> 661 -> 555 -> 474 -> 346 -> 204 -> 51 measured live).
			// Opening is animated by the stylesheet alone, which needs no clip of its own.
			void createCollapseMotion;
			try {
				const dismiss = createDrawerDismiss(runtime, () => layout);
				ctx.effect(() => dismiss.start(), PKG + ": drawer dismissal");
			} catch (error) {
				console.warn("[" + PKG + "] outside-tap dismissal unavailable:", error);
			}
			try {
				ctx.effect(() => createPanelPrefetch().start(), PKG + ": idle prefetch");
			} catch (error) {
				console.warn("[" + PKG + "] idle prefetch unavailable:", error);
			}
			const disposePublisher = ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: PKG + ".panel-state", order: 100 }, PanelStatePublisher),
			);

			const miracle = createMiracleTheme(ctx, prefs);
			try {
				ctx.effect(() => miracle.start(), PKG + ": Miracle palette");
			} catch (error) {
				console.warn("[" + PKG + "] Miracle palette unavailable; keeping the shipped theme:", error);
			}

			/** Subscribe one component to the runtime snapshot. */
			function useRuntimeState() {
				const [value, setValue] = React.useState(() => runtime.get());
				React.useEffect(() => runtime.subscribe(() => setValue(runtime.get())), []);
				return value;
			}

			/** Subscribe to the preference store. */
			function usePrefs() {
				const [value, setValue] = React.useState(() => prefs.get());
				React.useEffect(() => prefs.subscribe(() => setValue(prefs.get())), []);
				return value;
			}

			/**
			 * Read the shell's sidebar state for the readout row only.
			 *
			 * Purely observational. v1 derived *actions* from this read and that
			 * read-modify-write is what produced a state the user could not leave;
			 * nothing here writes.
			 */
			function useSidebarExpanded() {
				const read = () => {
					try {
						return document.querySelector(FRAME_MARK) !== null && !sidebarCollapsed();
					} catch (error) {
						return false;
					}
				};
				const [expanded, setExpanded] = React.useState(read);
				React.useEffect(() => {
					let observer = null;
					try {
						observer = new MutationObserver(() => setExpanded(read()));
						observer.observe(document.documentElement, {
							subtree: true,
							attributes: true,
							attributeFilter: ["data-sidebar-collapsed"],
						});
					} catch (error) {
						observer = null;
					}
					return () => {
						if (observer !== null) observer.disconnect();
					};
				}, []);
				return expanded;
			}

			/**
			 * The sidebar toggle for a narrow phone, where the rail is gone.
			 *
			 * It renders into `conversation.header.leading` — the shell's own seat for
			 * "global navigation before the Session title", shipped empty — which is a
			 * seat **inside the conversation column**. That placement is the whole point:
			 *
			 *  - the conversation column is never covered by anything this plugin owns
			 *    (it owns no overlay and positions nothing), so the button stays tappable
			 *    in every state, including while the sidebar is open;
			 *  - it is never rendered inside the thing it opens, so opening the sidebar
			 *    cannot hide its own close affordance. v1 put the equivalent control
			 *    under a scrim and locked the user out; this is the correction.
			 *
			 * It renders only when this plugin has removed the rail (`narrow` + `phone`), and
			 * only while the sidebar is collapsed — the open drawer covers that corner, and a
			 * control nobody can reach is worse than no control. Closing is the shell's own
			 * toggle inside the sidebar header, which is always visible. A failed call is
			 * reported, never swallowed: silence is what made the original defect invisible.
			 */
			function AdaptiveNavButton() {
				try {
					// EVERY hook runs on every render, before any early return. Inserting a
					// hook after one is a hooks-order violation the moment that branch is taken,
					// and React answers it by unmounting the entry: the button vanished on the
					// first toggle and never came back. `test/smoke.mjs` renders the button in
					// both drawer states, which is what that defect looked like from outside.
					const state = useRuntimeState();
					const expanded = useSidebarExpanded();
					const pressed = React.useState(false);
					const setPressed = pressed[1];
					if (!state.enabled || !state.narrow || state.form !== "phone" || layout === null) return null;
					const label = t(expanded ? "nav.close" : "nav.open");
					// Immediate press feedback: `:active` lands late on touch (and not at all on
					// some iOS versions without a touch handler), so the press state is driven
					// from the element's own pointer events — never a global listener.
					return h(
						"button",
						{
							type: "button",
							"data-dsh-adaptive-nav": "",
							"data-dsh-adaptive-pressed": pressed[0] ? "1" : undefined,
							"aria-label": label,
							"aria-expanded": expanded ? "true" : "false",
							title: label,
							onPointerDown: () => setPressed(true),
							onPointerUp: () => setPressed(false),
							onPointerCancel: () => setPressed(false),
							onPointerLeave: () => setPressed(false),
							onClick: () => {
								try {
									layout.toggleSidebar();
								} catch (error) {
									console.warn("[" + PKG + "] toggling the sidebar failed:", error);
								}
							},
						},
						h(PanelGlyph),
					);
				} catch (error) {
					return null;
				}
			}

			/**
			 * A read-only row reporting what the plugin actually measured.
			 *
			 * Miracle's honesty rule applied to a diagnostic: every figure has a real
			 * source and an unreadable one shows `—` rather than a plausible guess. It
			 * exists so a layout report can quote numbers instead of describing the
			 * screen.
			 */
			/**
			 * Report what this plugin's styles are actually landing on.
			 *
			 * Every card and motion rule here is addressed by a marker the shell publishes, and
			 * more than one round was spent styling a marker that never appears in a transcript.
			 * The counts are read from the live document each time the settings page renders, so
			 * one line from this row settles which markers exist instead of another guess.
			 */
			const PROBE_MARKERS = [
				["think", '[data-variant="think"]'],
				["cmd", '[data-sample="bash"]'],
				["tool", "[data-tool]"],
				["group", '[data-chat-flow-kind="turn-process"]'],
				["inline", "[data-turn-process-inline]"],
				["disc", "[data-disclosure-row]"],
				["panel", "[data-sidebar-right-panel]"],
			];

			/**
			 * The settings panel's real element chain, with measured widths.
			 *
			 * The shipped stylesheet says the panel is 800px wide with a fixed 188px section
			 * column, and that is all this plugin knew when it tried to lay that panel out for a
			 * phone — the attempt guessed the relation between the three nodes, matched the wrong
			 * ones and squeezed the sections into vertical strips. These numbers replace the
			 * guessing: the chain is read from `settings.section` upwards with each node's tag,
			 * its first class (which is what a hash-named rule keys on) and its measured width.
			 */
			function settingsChain() {
				try {
					const slot = document.querySelector('[data-slot="settings.section"]');
					if (slot === null) return t("readout.settingsClosed");
					const parts = [];
					let node = slot.parentElement;
					for (let depth = 0; depth < 6 && node !== null && node !== document.documentElement; depth++) {
						let label = node.tagName.toLowerCase();
						try {
							const first = node.classList !== undefined && node.classList.length > 0 ? node.classList[0] : "";
							if (first !== "") label += "." + String(first).slice(0, 18);
						} catch (error) {
							/* 忽略 */
						}
						let width = -1;
						try {
							width = Math.round(node.getBoundingClientRect().width);
						} catch (error) {
							width = -1;
						}
						parts.push(label + "(" + width + ")");
						node = node.parentElement;
					}
					return parts.join(" < ");
				} catch (error) {
					return t("readout.unknown");
				}
			}

			/** Marker hit counts, read from the live document. */
			function probeCounts() {
				let value = "";
				for (let i = 0; i < PROBE_MARKERS.length; i++) {
					let count = -1;
					try {
						count = document.querySelectorAll(PROBE_MARKERS[i][1]).length;
					} catch (error) {
						count = -1;
					}
					value += (i > 0 ? " · " : "") + PROBE_MARKERS[i][0] + " " + count;
				}
				return value;
			}

			function AdaptiveReadoutRow() {
				try {
					const state = useRuntimeState();
					const expanded = useSidebarExpanded();
					const value =
						!state.enabled || state.width <= 0
							? t("readout.unknown")
							: t("readout." + state.form) +
								" / " +
								t(state.narrow ? "readout.narrow" : "readout.wide") +
								" / " +
								state.width +
								"x" +
								state.height +
								" / " +
								t(state.touch ? "readout.touchOn" : "readout.touchOff") +
								" / " +
								t(expanded ? "readout.sidebarOpen" : "readout.sidebarClosed") +
								" / " +
								t("readout.theme") +
								" " +
								(miracle.isApplied() ? "miracle" : "shipped") +
								(state.enabled ? "\n" + probeCounts() + "\n" + settingsChain() : "");
					return h(SettingsRow, {
						title: t("row.readout.title"),
						description: t("row.readout.desc"),
						control: h("div", { "data-dsh-adaptive-readout": "" }, value),
					});
				} catch (error) {
					return null;
				}
			}

			/** One switch row. */
			function AdaptiveSwitchRow(props) {
				try {
					const all = usePrefs();
					const title = t(props.titleKey);
					return h(SettingsRow, {
						title: title,
						description: t(props.descKey),
						control: h("input", {
							type: "checkbox",
							"data-dsh-adaptive-switch": "",
							checked: all[props.field] === true,
							"aria-label": title,
							onChange: (event) => prefs.set(props.field, event.target.checked),
						}),
					});
				} catch (error) {
					return null;
				}
			}

			/** One select row. */
			function AdaptiveSelectRow(props) {
				try {
					const all = usePrefs();
					const title = t(props.titleKey);
					const options = props.options.map((option) => h("option", { key: option.value, value: option.value }, t(option.labelKey)));
					return h(SettingsRow, {
						title: title,
						description: t(props.descKey),
						control: h(
							"select",
							{
								"data-dsh-adaptive-select": "",
								value: typeof all[props.field] === "string" ? all[props.field] : props.options[0].value,
								"aria-label": title,
								onChange: (event) => prefs.set(props.field, event.target.value),
							},
							options,
						),
					});
				} catch (error) {
					return null;
				}
			}

			/** The rows this plugin contributes to the General section, in display order. */
			const ROWS = [
				{ id: PKG + ".enabled", order: 40, kind: "switch", field: "enabled", titleKey: "row.enabled.title", descKey: "row.enabled.desc" },
				{
					id: PKG + ".form",
					order: 41,
					kind: "select",
					field: "form",
					titleKey: "row.form.title",
					descKey: "row.form.desc",
					options: [
						{ value: "auto", labelKey: "row.form.auto" },
						{ value: "phone", labelKey: "row.form.phone" },
						{ value: "tablet", labelKey: "row.form.tablet" },
						{ value: "desktop", labelKey: "row.form.desktop" },
					],
				},
				{
					id: PKG + ".density",
					order: 42,
					kind: "select",
					field: "density",
					titleKey: "row.density.title",
					descKey: "row.density.desc",
					options: [
						{ value: "auto", labelKey: "row.density.auto" },
						{ value: "on", labelKey: "row.density.on" },
						{ value: "off", labelKey: "row.density.off" },
					],
				},
				{ id: PKG + ".touch", order: 43, kind: "switch", field: "touch", titleKey: "row.touch.title", descKey: "row.touch.desc" },
				{ id: PKG + ".compat", order: 44, kind: "switch", field: "compat", titleKey: "row.compat.title", descKey: "row.compat.desc" },
				{ id: PKG + ".miracle", order: 45, kind: "switch", field: "miracle", titleKey: "row.miracle.title", descKey: "row.miracle.desc" },
				{ id: PKG + ".push", order: 46, kind: "switch", field: "push", titleKey: "row.push.title", descKey: "row.push.desc" },
				{ id: PKG + ".wide", order: 48, kind: "switch", field: "wide", titleKey: "row.wide.title", descKey: "row.wide.desc" },
				{ id: PKG + ".readout", order: 47, kind: "readout", titleKey: "row.readout.title", descKey: "row.readout.desc" },
			];

			// The nav seat first: it is the safety net for the rail removal, so it must be
			// registered even if something later in this function goes wrong.
			const disposeNav = ctx.slots.inject("conversation.header.leading", () =>
				ctx.slots.register({ name: "conversation.header.leading", id: PKG + ".nav", order: 10, label: () => t("nav.open") }, AdaptiveNavButton),
			);

			// `register(options, component)` takes no props argument: bind the row's own
			// fields in a per-row component, created once per registration so its identity
			// stays stable across renders.
			const disposeRows = ROWS.map((row) => {
				const Base = row.kind === "switch" ? AdaptiveSwitchRow : row.kind === "select" ? AdaptiveSelectRow : AdaptiveReadoutRow;
				const Bound = (props) => Base(Object.assign({}, props, row));
				Bound.displayName = "AdaptiveShellRow(" + row.id + ")";
				return ctx.slots.inject("settings.general.item", () =>
					ctx.slots.register({ name: "settings.general.item", id: row.id, order: row.order, label: () => t(row.titleKey) }, Bound),
				);
			});

			return () => {
				disposeNav();
				disposePublisher();
				for (let i = 0; i < disposeRows.length; i++) disposeRows[i]();
			};
		}

		//#endregion

		exports.name = "adaptive-shell";
		exports.inject = INJECT;
		exports.apply = apply;

		// Test-only surface for `test/smoke.mjs`: the stylesheet is audited statically
		// and the classifier is exercised at its boundaries without a browser.
		exports.__css = CSS;
		exports.__classify = classify;
		exports.__rules = RULES;
		exports.__dicts = { zh: DICT_ZH, en: DICT_EN };
		exports.__tokens = MIRACLE_TOKENS;

		return module.exports;
	},
});
