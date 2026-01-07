import SwiftUI

struct Shimmer: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        ZStack {
            LinearGradient(
                gradient: Gradient(colors: [.white.opacity(1.0), .clear, .white.opacity(1.0)]),
                startPoint: .leading,
                endPoint: .trailing
            )
            .blur(radius: 10)

            LinearGradient(
                gradient: Gradient(colors: [
                    .white.opacity(1.0),
                    .white.opacity(0.9),
                    .white.opacity(1.0)
                ]),
                startPoint: .leading,
                endPoint: .trailing
            )
            .mask(
                LinearGradient(
                    gradient: Gradient(stops: [
                        .init(color: .clear, location: 0.1),
                        .init(color: .black.opacity(0.8), location: 0.5),
                        .init(color: .clear, location: 0.9)
                    ]),
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .offset(x: phase * 300)
        }
        .onAppear {
            withAnimation(Animation.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}

extension View {
    func shimmer() -> some View {
        self.overlay(
            Shimmer()
                .mask(self)
        )
    }
}
