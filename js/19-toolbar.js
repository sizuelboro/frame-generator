/**
 * Toolbar menus and the stage empty state.
 *
 * Loaded after the Studio scripts so the original handlers remain intact.
 */
;(function () {
	"use strict"
	var MENUS = [
		{ btn: "btnFileMenu", menu: "menuFile" },
		{ btn: "btnToolsMenu", menu: "menuTools" },
		{ btn: "btnAdvancedMenu", menu: "menuAdvanced" },
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
		menu.addEventListener("click", function (e) {
			if (e.target && e.target.closest && e.target.closest("button")) closeAll()
		})
	})
	document.addEventListener("click", function () { closeAll() })
	document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll() })
	function forward(fromId, toSelector) {
		var from = document.getElementById(fromId)
		var to = document.querySelector(toSelector)
		if (!from || !to) return
		from.addEventListener("click", function () { to.click() })
	}
	forward("esAddOpening", "#btnAddRatioFrame")
	forward("esAddOverlay", '[data-act="addOverlay"]')
	var stateEl = document.getElementById("emptyState")
	var layerList = document.getElementById("layerList")
	if (stateEl && layerList) {
		// The list always has a child (the "No layers yet" note when empty), so
		// look for real layer rows rather than counting children.
		var sync = function () { stateEl.classList.toggle("gone", !!layerList.querySelector(".layer")) }
		sync()
		if (typeof MutationObserver === "function") new MutationObserver(sync).observe(layerList, { childList: true })
	}
})()
