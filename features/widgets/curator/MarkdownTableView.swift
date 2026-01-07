import SwiftUI

// ─────────── Table Column Width Preference ───────────
private struct ColumnWidthKey: PreferenceKey {
	static var defaultValue: [Int: CGFloat] = [:]
	static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
		let next = nextValue()
		for (k, v) in next { value[k] = max(value[k] ?? 0, v) }
	}
}

// ─────────── Markdown Table View ───────────
struct MarkdownTableView: View {
	let headers: [String]
	let rows: [[String]]
	
	@State private var colWidths: [Int: CGFloat] = [:]
	
	private let minCol: CGFloat = 90
	private let maxCol: CGFloat = 180
	
	var body: some View {
		let rule = Color.accentSecondary
		let headerTint = Color.accentSecondary.opacity(0.06)
		
		VStack(spacing: 0) {
			ZStack {
				headerTint
				HStack(alignment: .top, spacing: 0) {
					ForEach(headers.indices, id: \.self) { idx in
						TableCell(
							text: headers[idx],
							isHeader: true,
							colIndex: idx,
							assignedWidth: clampedWidth(for: idx),
							minCol: minCol,
							maxCol: maxCol
						)
						if idx < headers.count - 1 {
							Rectangle().frame(width: 1).foregroundStyle(rule.opacity(0.18))
						}
					}
				}
			}
			
			Rectangle().frame(height: 1).foregroundStyle(rule)
			
			ForEach(rows.indices, id: \.self) { r in
				HStack(alignment: .top, spacing: 0) {
					ForEach(headers.indices, id: \.self) { c in
						TableCell(
							text: c < rows[r].count ? rows[r][c] : "",
							isHeader: false,
							colIndex: c,
							assignedWidth: clampedWidth(for: c),
							minCol: minCol,
							maxCol: maxCol
						)
						if c < headers.count - 1 {
							Rectangle().frame(width: 1).foregroundStyle(rule.opacity(0.18))
						}
					}
				}
				if r < rows.count - 1 {
					Rectangle().frame(height: 1).foregroundStyle(rule.opacity(0.7))
				}
			}
		}
		.onPreferenceChange(ColumnWidthKey.self) { prefs in
			var out: [Int: CGFloat] = [:]
			for i in headers.indices {
				let w = prefs[i] ?? minCol
				out[i] = max(minCol, min(maxCol, w))
			}
			colWidths = out
		}
		.frame(minWidth: totalWidth, alignment: .leading)
		.clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
		.overlay(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.stroke(rule.opacity(0.55), lineWidth: 1)
		)
		.padding(.vertical, 2)
	}
	
	private func clampedWidth(for idx: Int) -> CGFloat {
		max(minCol, min(maxCol, colWidths[idx] ?? minCol))
	}
	
	private var totalWidth: CGFloat {
		let sep = CGFloat(max(0, headers.count - 1)) * 1.0
		let sum = headers.indices.reduce(0) { $0 + clampedWidth(for: $1) }
		return min(sum + sep, UIScreen.main.bounds.width * 1.15)
	}
}

// ─────────── Table Cell ───────────
private struct TableCell: View {
	let text: String
	let isHeader: Bool
	let colIndex: Int
	let assignedWidth: CGFloat
	let minCol: CGFloat
	let maxCol: CGFloat
	
	var body: some View {
		let display = displayText(for: text)
		
		Text(display)
			.font(isHeader ? .system(size: 15, weight: .semibold) : .system(size: 15))
			.foregroundColor(.primary)
			.multilineTextAlignment(.leading)
			.fixedSize(horizontal: false, vertical: true)
			.frame(width: assignedWidth, alignment: .topLeading)
			.padding(.vertical, 10)
			.padding(.horizontal, 12)
			.overlay(
				GeometryReader { geo in
					Color.clear.preference(
						key: ColumnWidthKey.self,
						value: [colIndex: min(maxCol, max(minCol, geo.size.width))]
					)
				}
			)
	}
}

// ─────────── Display Shortener ───────────
private func displayText(for raw: String) -> String {
	let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
	if let url = URL(string: trimmed), let host = url.host {
		let comps = url.pathComponents.filter { $0 != "/" }
		let tail = comps.suffix(2).joined(separator: "/")
		let shown = tail.isEmpty ? host : "\(host)/\(tail)"
		return shown.count > 50 ? String(shown.prefix(25)) + "…" + String(shown.suffix(20)) : shown
	}
	if trimmed.count > 60 {
		return String(trimmed.prefix(28)) + "…" + String(trimmed.suffix(20))
	}
	return trimmed
}
