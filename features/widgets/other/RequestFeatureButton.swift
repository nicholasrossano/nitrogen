import SwiftUI

struct RequestFeatureButton: View {
    var action: () -> Void
    @Binding var isVisible: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: "square.and.pencil")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 24, height: 24)
                .foregroundColor(.white)
                .offset(x: 2, y: -2)
                .padding()
                .background(Color.accentPrimary)
                .clipShape(Circle())
                .shadow(color: .gray, radius: 4, x: 0, y: 2)
        }
        .offset(x: 5, y: 10)
        .opacity(isVisible ? 1 : 0)
        .animation(.easeInOut, value: isVisible)
    }
}

struct RequestTopicButton_Previews: PreviewProvider {
    static var previews: some View {
        RequestFeatureButton(action: {}, isVisible: .constant(true))
    }
}
