import SwiftUI
import UIKit

extension String {
    func cleanedContent() -> String {
        let withoutCitations = self.replacingOccurrences(
            of: "\\s?\\[\\d+(,\\d+)*\\]",
            with: "",
            options: .regularExpression
        )
        return withoutCitations.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func toAvenirAttributedString(baseSize: CGFloat) -> NSAttributedString {
        do {
            var swiftUIAttr = try AttributedString(
                markdown: self,
                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            )
            let range = swiftUIAttr.startIndex..<swiftUIAttr.endIndex
            swiftUIAttr[range].font = .custom("Avenir", size: baseSize)
            return NSAttributedString(swiftUIAttr)
        } catch {
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont(name: "Avenir", size: baseSize) ?? UIFont.systemFont(ofSize: baseSize)
            ]
            return NSAttributedString(string: self, attributes: attrs)
        }
    }
}
