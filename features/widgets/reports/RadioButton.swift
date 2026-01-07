import SwiftUI

struct RadioButton: View {
    let title: String
    var isSelected: Bool
    var accentColor: Color = Color.accentPrimary

    var body: some View {
        HStack {
            Circle()
                .stroke(isSelected ? accentColor : Color.gray, lineWidth: 2)
                .background(Circle().fill(isSelected ? accentColor : Color.clear))
                .frame(width: 15, height: 15)
            Text(title)
                .foregroundColor(.primary)
                .padding(.leading, 5)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
    }
}
