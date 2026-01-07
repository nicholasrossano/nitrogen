import SwiftUI

struct SwipeBackModifier: ViewModifier {
    @Environment(\.presentationMode) var presentationMode
    @State private var dragOffset: CGFloat = 0
    
    private let threshold: CGFloat
    private let edgeWidth: CGFloat

    init(threshold: CGFloat = 100, edgeWidth: CGFloat = 20) {
        self.threshold = threshold
        self.edgeWidth = edgeWidth
    }
    
    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if value.startLocation.x < edgeWidth && value.translation.width > 0 {
                            dragOffset = value.translation.width
                        }
                    }
                    .onEnded { value in
                        if value.translation.width > threshold {
                            presentationMode.wrappedValue.dismiss()
                        }
                        dragOffset = 0
                    }
            )
            .offset(x: dragOffset)
            .animation(.easeOut, value: dragOffset)
    }
}

extension View {
    func swipeBack(threshold: CGFloat = 50, edgeWidth: CGFloat = 20) -> some View {
        self.modifier(SwipeBackModifier(threshold: threshold, edgeWidth: edgeWidth))
    }
}
