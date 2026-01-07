import SwiftUI
import SafariServices

struct MessageBubble: View {
	// ─────────── Public API ───────────
	let message: String
	let isUser: Bool
	
	// ─────────── Placeholder detection ───────────
	private var isPlaceholder: Bool { message == "…" || message == "..." }
	private let placeholderTaglines = [
		"Thinking…",
		"On it…",
		"Working…",
		"Give me a moment…",
		"Pulling that together…",
		"Working on it…",
		"Hold on…"
	]
	
	// ─────────── UI State ───────────
	@State private var visible: [Bool] = []
	@State private var showPlaceholder = false
	
	// ─────────── Safari sheet ───────────
	@State private var safariURL: URL?
	
	// ─────────── Parsed lines (supports lists/code) ───────────
	private var renderLines: [RenderLine] {
		if isPlaceholder {
			return [RenderLine(text: placeholderTaglines.randomElement() ?? "Thinking…",
							   kind: .normal,
							   indentLevel: 0)]
		}
		return MarkdownLineParser.parse(message)
	}
	
	var body: some View {
		let maybeTable = isUser ? nil : parseFirstMarkdownTable(message)
		
		let textStack = VStack(alignment: .leading, spacing: 4) {
			ForEach(renderLines.indices, id: \.self) { idx in
				lineView(for: renderLines[idx])
					.opacity(visible[safe: idx] ?? false ? 1 : 0)
					.animation(.easeIn(duration: 0.3).delay(Double(idx) * 0.1),
							   value: visible[safe: idx] ?? false)
			}
		}
		
		let tableStack: some View = Group {
			if let parsed = maybeTable {
				VStack(alignment: .leading, spacing: 12) {
					if !parsed.pre.isEmpty {
						lineStack(for: parsed.pre)
					}
					
					let threadPad: CGFloat = 32
					ScrollView(.horizontal, showsIndicators: false) {
						HStack(spacing: 0) {
							Color.clear.frame(width: threadPad)
							MarkdownTableView(headers: parsed.headers, rows: parsed.rows)
								.frame(minWidth: UIScreen.main.bounds.width - threadPad, alignment: .leading)
						}
					}
					.padding(.horizontal, -threadPad)
					
					if !parsed.post.isEmpty {
						lineStack(for: parsed.post)
					}
				}
			} else {
				textStack
			}
		}
		
		Group {
			if isUser {
				textStack
					.padding(10)
					.background(
						Color.white.opacity(0.7),
						in: RoundedRectangle(cornerRadius: 25)
					)
			} else {
				tableStack
			}
		}
		.opacity(!isPlaceholder || showPlaceholder ? 1 : 0)
		.fixedSize(horizontal: false, vertical: true)
		.accentColor(.secondary)
		.environment(\.openURL, OpenURLAction { url in
			safariURL = url
			return .handled
		})
		.sheet(item: $safariURL) { url in
			SafariView(url: url)
		}
		.onAppear { handleOnAppear() }
	}
	
	// ─────────── Build each line ───────────
	@ViewBuilder
	private func lineView(for line: RenderLine) -> some View {
		let textColor: Color = isUser ? .black : .primary
		
		switch line.kind {
		case .code:
			Text(line.text)
				.font(.system(size: 16, weight: .regular, design: .monospaced))
				.foregroundColor(textColor)
				.padding(.leading, CGFloat(line.indentLevel) * 16)
			
		case .bullet(let symbol), .ordered(let symbol), .task(let symbol):
			HStack(alignment: .firstTextBaseline, spacing: 8) {
				Text(symbol)
					.font(.custom("Avenir", size: 16))
					.foregroundColor(textColor)
					.frame(width: 16, alignment: .trailing)
				
				if var attr = try? AttributedString(markdown: line.text) {
					let firstLink = attr.runs.compactMap { $0.link }.first
					Text(attr)
						.font(.custom("Avenir", size: 16))
						.foregroundColor(textColor)
						.applyContextMenu(url: firstLink, safariURL: $safariURL)
				} else {
					Text(line.text)
						.font(.custom("Avenir", size: 16))
						.foregroundColor(textColor)
				}
			}
			.padding(.leading, CGFloat(line.indentLevel) * 16)
			
		case .normal:
			if var attr = try? AttributedString(markdown: line.text) {
				let firstLink = attr.runs.compactMap { $0.link }.first
				Text(attr)
					.font(.custom("Avenir", size: 16))
					.foregroundColor(textColor)
					.applyContextMenu(url: firstLink, safariURL: $safariURL)
					.padding(.leading, CGFloat(line.indentLevel) * 16)
			} else {
				Text(line.text)
					.font(.custom("Avenir", size: 16))
					.foregroundColor(textColor)
					.padding(.leading, CGFloat(line.indentLevel) * 16)
			}
		}
	}
	
	// ─────────── Inline stack for pre/post text around a table ───────────
	@ViewBuilder
	private func lineStack(for text: String) -> some View {
		let lines = MarkdownLineParser.parse(text)
		VStack(alignment: .leading, spacing: 4) {
			ForEach(lines.indices, id: \.self) { idx in
				lineView(for: lines[idx])
			}
		}
	}
	
	// ─────────── Appear helper ───────────
	private func handleOnAppear() {
		if isPlaceholder {
			DispatchQueue.main.asyncAfter(deadline: .now()) {
				showPlaceholder = true
				revealLines()
			}
		} else {
			showPlaceholder = true
			revealLines()
		}
	}
	
	// ─────────── Reveal animation helper ───────────
	private func revealLines() {
		guard visible.count != renderLines.count else { return }
		visible = Array(repeating: false, count: renderLines.count)
		for idx in renderLines.indices {
			DispatchQueue.main.asyncAfter(deadline: .now() + Double(idx) * 0.1) {
				visible[idx] = true
			}
		}
	}
}

// ─────────── Safe-index helper ───────────
private extension Array {
	subscript(safe index: Index) -> Element? {
		indices.contains(index) ? self[index] : nil
	}
}

// ─────────── Context-menu modifier ───────────
private extension View {
	func applyContextMenu(url: URL?, safariURL: Binding<URL?>) -> some View {
		modifier(LinkPreviewModifier(url: url, safariURL: safariURL))
	}
}

private struct LinkPreviewModifier: ViewModifier {
	let url: URL?
	@Binding var safariURL: URL?
	
	func body(content: Content) -> some View {
		if let link = url {
			content
				.contextMenu {
					Button("Open Link") { safariURL = link }
				} preview: {
					SafariView(url: link)
				}
		} else {
			content
		}
	}
}

// ─────────── Parser & Models ───────────
private enum LineKind {
	case normal
	case bullet(symbol: String)
	case ordered(symbol: String)
	case task(symbol: String)
	case code
}

private struct RenderLine {
	let text: String
	let kind: LineKind
	let indentLevel: Int
}

private enum MarkdownLineParser {
	static func parse(_ message: String) -> [RenderLine] {
		var lines: [RenderLine] = []
		let rawLines = message.replacingOccurrences(of: "\r\n", with: "\n")
			.replacingOccurrences(of: "\r", with: "\n")
			.components(separatedBy: .newlines)
		
		var inCode = false
		
		for raw in rawLines {
			let line = raw
			if isFence(line) {
				inCode.toggle()
				continue
			}
			if inCode {
				lines.append(RenderLine(text: line, kind: .code, indentLevel: 0))
				continue
			}
			
			if let task = parseTask(line) {
				lines.append(task)
				continue
			}
			if let bullet = parseBullet(line) {
				lines.append(bullet)
				continue
			}
			if let ordered = parseOrdered(line) {
				lines.append(ordered)
				continue
			}
			
			let indent = leadingSpaces(line) / 2
			lines.append(RenderLine(text: line.trimmingCharacters(in: .whitespaces),
									kind: .normal,
									indentLevel: indent))
		}
		
		return lines
	}
	
	private static func isFence(_ s: String) -> Bool {
		let trimmed = s.trimmingCharacters(in: .whitespaces)
		return trimmed.hasPrefix("```")
	}
	
	private static func leadingSpaces(_ s: String) -> Int {
		var count = 0
		for ch in s { if ch == " " { count += 1 } else { break } }
		return count
	}
	
	private static func parseTask(_ s: String) -> RenderLine? {
		guard let match = firstMatch(s, pattern: #"^(\s*)[-*+]\s+$begin:math:display$( |x|X)$end:math:display$\s+(.*)$"#) else { return nil }
		let spaces = match[1]
		let checked = match[2].lowercased() == "x"
		let text = match[3]
		let symbol = checked ? "☑︎" : "☐"
		let indent = leadingSpaces(spaces) / 2
		return RenderLine(text: text, kind: .task(symbol: symbol), indentLevel: indent)
	}
	
	private static func parseBullet(_ s: String) -> RenderLine? {
		guard let match = firstMatch(s, pattern: #"^(\s*)[-*+]\s+(.*)$"#) else { return nil }
		let indent = leadingSpaces(match[1]) / 2
		let text = match[2]
		return RenderLine(text: text, kind: .bullet(symbol: "•"), indentLevel: indent)
	}
	
	private static func parseOrdered(_ s: String) -> RenderLine? {
		guard let match = firstMatch(s, pattern: #"^(\s*)(\d+)[\.)]\s+(.*)$"#) else { return nil }
		let indent = leadingSpaces(match[1]) / 2
		let num    = match[2]
		let text   = match[3]
		return RenderLine(text: text, kind: .ordered(symbol: "\(num)."), indentLevel: indent)
	}
	
	private static func firstMatch(_ s: String, pattern: String) -> [String]? {
		guard let rx = try? NSRegularExpression(pattern: pattern) else { return nil }
		let ns = NSRange(s.startIndex..., in: s)
		guard let m = rx.firstMatch(in: s, options: [], range: ns) else { return nil }
		var groups: [String] = []
		for i in 0..<m.numberOfRanges {
			let r = m.range(at: i)
			if let rr = Range(r, in: s) { groups.append(String(s[rr])) } else { groups.append("") }
		}
		return groups
	}
}

// ─────────── Markdown Table Parsing ───────────
private func parseFirstMarkdownTable(_ text: String) -> (pre: String, headers: [String], rows: [[String]], post: String)? {
	let lines = text.components(separatedBy: .newlines)
	guard lines.count >= 2 else { return nil }
	let dividerRegex = try! NSRegularExpression(pattern: #"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$"#)
	var headerIdx: Int? = nil
	var dividerIdx: Int? = nil
	for i in 0..<(lines.count - 1) {
		let header = lines[i]
		let divider = lines[i + 1]
		guard header.contains("|") else { continue }
		if dividerRegex.firstMatch(in: divider, options: [], range: NSRange(location: 0, length: divider.utf16.count)) != nil {
			headerIdx = i; dividerIdx = i + 1; break
		}
	}
	guard let h = headerIdx, let d = dividerIdx else { return nil }
	var end = d + 1
	while end < lines.count, lines[end].contains("|"), !lines[end].trimmingCharacters(in: .whitespaces).isEmpty { end += 1 }
	let pre  = lines[0..<h].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
	let post = lines[end..<lines.count].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
	func splitRow(_ s: String) -> [String] {
		var parts = s.split(separator: "|", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
		if parts.first == "" { parts.removeFirst() }
		if parts.last  == "" { parts.removeLast() }
		return parts
	}
	let headers = splitRow(lines[h])
	let bodyRows = (d+1..<end).map { splitRow(lines[$0]) }.map { row in
		if row.count < headers.count { return row + Array(repeating: "", count: headers.count - row.count) }
		if row.count > headers.count { return Array(row.prefix(headers.count)) }
		return row
	}
	return (pre: pre, headers: headers, rows: bodyRows, post: post)
}
