/**
 * Toolbar menus and the stage empty state.
 *
 * This file owns no application state. Every menu item is one of the original
 * toolbar buttons, moved into a dropdown, so its handler in an earlier script
 * keeps working untouched. The empty-state buttons forward a click to the
 * control they stand in for rather than duplicating its logic.
 *
 * Loaded last: it only reads DOM that index.html already declares.
 */
;(function () {
	"use strict"

	/* ---------- dropdown menus ------------------------------------------ */

	var MENUS = [
		{ btn: "btnToolsMenu", menu: "menuTools" },
		{ btn: "btnExportMenu", menu: "menuExport" },
	]

	function closeAll(keepOpen) {
		for (var i = 0; i < MENUS.length; i++) {
			var menu = document.getElementById(MENUS[i].menu)
			var btn = document.getElementById(MENUS[i].btn)
			if (!menu || !btn || menu === keepOpen) continue
			menu.classList.remove("open")
			btn.setAttribute("aria-expanded", "false")
		}
	}

	MENUS.forEach(function (pair) {
		var btn = document.getElementById(pair.btn)
		var menu = document.getElementById(pair.menu)
		if (!btn || !menu) return

		btn.addEventListener("click", function (e) {
			e.stopPropagation()
			var open = !menu.classList.contains("open")
			closeAll(open ? menu : null)
			menu.classList.toggle("open", open)
			btn.setAttribute("aria-expanded", open ? "true" : "false")
		})

		// Let the click reach the original button, then get out of the way.
		menu.addEventListener("click", function (e) {
			if (e.target && e.target.closest && e.target.closest("button")) closeAll()
		})
	})

	document.addEventListener("click", function () {
		closeAll()
	})
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape") closeAll()
	})

	/* ---------- stage empty state --------------------------------------- */

	// Stand-in buttons: click the real control so there is one code path.
	function forward(fromId, toSelector) {
		var from = document.getElementById(fromId)
		var to = document.querySelector(toSelector)
		if (!from || !to) return
		from.addEventListener("click", function () {
			to.click()
		})
	}
	forward("esAddOpening", "#btnAddRatioFrame")
	forward("esAddOverlay", '[data-act="addOverlay"]')

	// The layer list is the only DOM signal for "this document is empty" that
	// does not reach into another script's state.
	var stateEl = document.getElementById("emptyState")
	var layerList = document.getElementById("layerList")

	if (stateEl && layerList) {
		var sync = function () {
			stateEl.classList.toggle("gone", layerList.children.length > 0)
		}
		sync()
		if (typeof MutationObserver === "function") {
			new MutationObserver(sync).observe(layerList, { childList: true })
		}
	}
})()
