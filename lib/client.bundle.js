// dsh-vision-paste — 浏览器端 bundle（手写 __ModuleLoader__ 格式，无需构建）
// 提供：conversation.input.left 的「📷 识图」按钮（点击选图/拖拽）+ 全局捕获阶段粘贴拦截
// 图片字节经 fetch POST /api/vision-paste 落盘，路径写入输入框 draft。
window.__ModuleLoader__.load({
	id: "dsh-vision-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		function base64FromBytes(bytes) {
			const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			let out = "";
			let i = 0;
			for (; i + 3 <= bytes.length; i += 3) {
				const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
				out += CH[(n >> 18) & 63] + CH[(n >> 12) & 63] + CH[(n >> 6) & 63] + CH[n & 63];
			}
			const rem = bytes.length - i;
			if (rem === 1) {
				const n = bytes[i] << 16;
				out += CH[(n >> 18) & 63] + CH[(n >> 12) & 63] + "==";
			} else if (rem === 2) {
				const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
				out += CH[(n >> 18) & 63] + CH[(n >> 12) & 63] + CH[(n >> 6) & 63] + "=";
			}
			return out;
		}

		function saveImage(file, actions, draft) {
			if (!file || !actions) return;
			if (!/^image\//.test(file.type)) {
				console.log("[dsh-vision-tools] 非图片文件：" + file.type);
				return;
			}
			file.arrayBuffer().then((buf) => {
				const payload = {
					name: file.name || "pasted.png",
					base64: base64FromBytes(new Uint8Array(buf)),
				};
				return fetch("/api/vision-paste", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
			}).then((res) => res.json()).then((result) => {
				if (result && result.path) {
					const prefix = draft && draft.trim() ? draft + "\n" : "";
					actions.setDraft(prefix + "请识别这张图片：" + result.path);
				} else {
					console.error("[dsh-vision-tools] 保存失败：" + JSON.stringify(result));
				}
			}).catch((e) => {
				console.error("[dsh-vision-tools] 保存失败：" + String((e && e.message) || e));
			});
		}

		const plugin = {
			name: "dsh-vision-tools",
			inject: ["slots"],
			apply(ctx) {
				const slots = ctx.get("slots");
				if (slots === undefined) return;
				let latestActions = null;
				let latestDraft = "";

				// 全局粘贴拦截：捕获阶段先于输入框自身处理，把剪贴板图片改道落盘
				ctx.effect(() => {
					const onPaste = (e) => {
						const items = (e.clipboardData && e.clipboardData.items)
							? Array.prototype.slice.call(e.clipboardData.items)
							: [];
						const imgItem = items.find((it) => it.kind === "file" && /^image\//.test(it.type));
						const file = imgItem
							? imgItem.getAsFile()
							: ((e.clipboardData && e.clipboardData.files && e.clipboardData.files[0]) || null);
						if (!file || !/^image\//.test(file.type)) return;
						e.preventDefault();
						e.stopPropagation();
						saveImage(file, latestActions, latestDraft);
					};
					document.addEventListener("paste", onPaste, true);
					return () => document.removeEventListener("paste", onPaste, true);
				});

				function VisionPasteButton(props) {
					latestActions = props.inputActions;
					const input = props.input;
					latestDraft = (input && (input.text ?? input.draft ?? input.value)) || "";
					const inputRef = react.useRef ? react.useRef(null) : { current: null };
					return react.createElement("div", {
						style: { display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 },
						title: "选择或拖入图片（也可直接 Cmd/Ctrl+V 粘贴截图），自动落盘并填入路径",
						onDragOver: (e) => { e.preventDefault(); },
						onDrop: (e) => {
							e.preventDefault();
							if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
								saveImage(e.dataTransfer.files[0], latestActions, latestDraft);
							}
						},
					}, [
						react.createElement("button", {
							key: "btn",
							style: {
								cursor: "pointer", border: "1px solid #ccc", borderRadius: 6,
								background: "#fff", padding: "2px 8px", fontSize: 13,
								color: "#1B4B82", lineHeight: "20px",
							},
							onClick: () => { if (inputRef.current) inputRef.current.click(); },
						}, "📷 识图"),
						react.createElement("input", {
							key: "file",
							ref: inputRef,
							type: "file",
							accept: "image/*",
							style: { display: "none" },
							onChange: (e) => {
								const f = e.target.files && e.target.files[0];
								if (f) saveImage(f, latestActions, latestDraft);
								e.target.value = "";
							},
						}),
					]);
				}

				slots.inject("conversation.input.left", () => slots.register(
					{ name: "conversation.input.left", id: "vision-paste-button", order: 10 },
					(props) => react.createElement(VisionPasteButton, props),
				));
			},
		};

		exports.default = plugin;
		return exports;
	}
});
