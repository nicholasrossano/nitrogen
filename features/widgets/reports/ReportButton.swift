import SwiftUI
import UIKit
import LinkPresentation

struct ReportButton: View {
    let cardId: String
    @State private var showMenu = false
    @EnvironmentObject var servicesLocator: AppServicesLocator

    var body: some View {
        let screenWidth = UIScreen.main.bounds.width
        let size = screenWidth * 0.1
        let imgSize = size * 0.4

        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            showMenu = true
        } label: {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: imgSize))
				.foregroundColor(Color(.systemBackground))
                .frame(width: size, height: size)
        }
        .sheet(isPresented: $showMenu) {
            ReportMenu(isPresented: $showMenu, cardId: cardId)
                .presentationDetents([.fraction(0.655), .large])
                .presentationDragIndicator(.visible)
        }
    }
}
