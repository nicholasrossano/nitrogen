import Foundation

// ─────────── MarkdownCopyFormatter ───────────
struct MarkdownCopyFormatter {
	static func plainText(from markdown: String) -> String {
		var text = markdown
			.replacingOccurrences(of: "\r\n", with: "\n")
			.replacingOccurrences(of: "\r", with: "\n")
		
		// Images: ![alt](url) -> "alt (url)"
		text = replaceRegex(text, pattern: #"\!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#, template: "$1 ($2)")
		
		// Links: [label](url) -> "label (url)"
		text = replaceRegex(text, pattern: #"\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#, template: "$1 ($2)")
		
		// Autolinks: <https://…> or <mailto:…> -> content
		text = replaceRegex(text, pattern: #"<(https?:\/\/[^>]+)>"#, template: "$1")
		text = replaceRegex(text, pattern: #"<mailto:([^>]+)>"#, template: "$1")
		
		// Bold / Italic
		text = replaceRegex(text, pattern: #"(\*\*|__)(.*?)\1"#, template: "$2", options: [.dotMatchesLineSeparators])
		text = replaceRegex(text, pattern: #"(\*|_)(.*?)\1"#, template: "$2", options: [.dotMatchesLineSeparators])
		
		// Headers: keep the title, drop the #'s
		text = replaceRegex(text, pattern: #"(?m)^\s{0,3}#{1,6}\s*"#, template: "")
		
		// Blockquotes
		text = replaceRegex(text, pattern: #"(?m)^\s{0,3}>\s?"#, template: "")
		
		// Horizontal rules
		text = replaceRegex(text, pattern: #"(?m)^\s{0,3}([-*_])\s?\1\s?\1(?:\1|\s)*$"#, template: "")
		
		// Fenced code blocks: keep content only
		text = replaceRegex(text, pattern: #"(?s)```(?:[\w+-]+\n)?(.*?)```"#, template: "$1")
		
		// Inline code
		text = replaceRegex(text, pattern: #"`([^`]+)`"#, template: "$1")
		
		// Lists -> bullets
		text = replaceRegex(text, pattern: #"(?m)^\s{0,3}(\d+\.)\s+"#, template: "• ")
		text = replaceRegex(text, pattern: #"(?m)^\s{0,3}[-*+]\s+"#, template: "• ")
		
		// Tables: drop alignment rows, simplify pipes
		text = replaceRegex(text, pattern: #"(?m)^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$"#, template: "")
		text = replaceRegex(text, pattern: #"(?m)^\s*\|(.+)\|\s*$"#, template: "$1")
		text = text.replacingOccurrences(of: " | ", with: " • ")
		
		// Footnotes, refs
		text = replaceRegex(text, pattern: #"$begin:math:display$\\^(\\d+)$end:math:display$:"#, template: "[$1]:")
		text = replaceRegex(text, pattern: #"$begin:math:display$\\^(\\d+)$end:math:display$"#, template: "[$1]")
		text = replaceRegex(text, pattern: #"$begin:math:display$([^$end:math:display$]+)\]$begin:math:display$[^$end:math:display$]+\]"#, template: "$1")
		
		// HTML: line breaks and strip tags
		text = replaceRegex(text, pattern: #"(?i)<br\s*/?>"#, template: "\n")
		text = replaceRegex(text, pattern: #"(?s)<[^>]+>"#, template: "")
		
		// Unescape common entities
		text = htmlEntityUnescape(text)
		
		// Remove backslash escapes
		text = replaceRegex(text, pattern: #"\\([\\`*_{}\[\]()#+.!-])"#, template: "$1")
		
		// Whitespace cleanup
		text = replaceRegex(text, pattern: #"(?m)[ \t]+$"#, template: "")
		text = replaceRegex(text, pattern: #"\n{3,}"#, template: "\n\n")
		
		return text.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	
	private static func replaceRegex(
		_ text: String,
		pattern: String,
		template: String,
		options: NSRegularExpression.Options = [],
		matchingOptions: NSRegularExpression.MatchingOptions = []
	) -> String {
		do {
			let regex = try NSRegularExpression(pattern: pattern, options: options)
			let range = NSRange(text.startIndex..., in: text)
			return regex.stringByReplacingMatches(in: text, options: matchingOptions, range: range, withTemplate: template)
		} catch {
			return text
		}
	}
	
	private static func htmlEntityUnescape(_ s: String) -> String {
		var out = s
		out = out.replacingOccurrences(of: "&amp;", with: "&")
		out = out.replacingOccurrences(of: "&lt;", with: "<")
		out = out.replacingOccurrences(of: "&gt;", with: ">")
		out = out.replacingOccurrences(of: "&quot;", with: "\"")
		out = out.replacingOccurrences(of: "&#39;", with: "'")
		return out
	}
}

extension String {
	func strippedMarkdownForCopy() -> String {
		MarkdownCopyFormatter.plainText(from: self)
	}
}
