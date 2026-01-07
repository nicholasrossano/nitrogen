import SwiftUI

struct StackedCardModifier: ViewModifier {
    let index: Int
    let itemWidth: CGFloat
    let numVisibleItems: Int

    func body(content: Content) -> some View {
        let scale = max(1.0 - CGFloat(index) * 0.05, 0.1)
        let verticalOffset = CGFloat(index) * 20

        return content
            .scaleEffect(scale)
            .frame(width: itemWidth, height: 400)
            .offset(y: verticalOffset)
            .opacity(index < numVisibleItems ? 1.0 : 0.0)
            .zIndex(Double(numVisibleItems - index))
            .animation(.easeInOut(duration: 0.3), value: index)
    }
}
