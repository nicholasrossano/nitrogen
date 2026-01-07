import SwiftUI

struct GlobalLoadingIndicator: View {
    var body: some View {
        ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: .primary))
            .scaleEffect(1.5, anchor: .center)
    }
}
