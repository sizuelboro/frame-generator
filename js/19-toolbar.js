/**
 * Toolbar menus.
 *
 * Loaded after the Studio scripts so the original handlers remain intact.
 * The stage empty state and the mode chooser live in 22-modes.js.
 */
;(function () {
	"use strict"
	var MENUS = [
		{ btn: "btnFileMenu", menu: "menuFile" },
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
	forward("esAddOverlay", '[data-act="addOverlay"]')
	forward("btnExportPixopikMenu", "#btnExportPixopik")
})()
