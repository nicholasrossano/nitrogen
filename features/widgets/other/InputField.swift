import SwiftUI

struct InputField: View {
    @Binding var text: String
    @FocusState private var isFocused: Bool
    var hintText: String?
    var maxLines: Int = 1
    var borderRadius: CGFloat = 10
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if maxLines == 1 {
                TextField(hintText ?? "", text: $text)
                    .focused($isFocused)
                    .font(.custom("Avenir", size: 14))
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .background(
                        RoundedRectangle(cornerRadius: borderRadius)
                            .strokeBorder(Color(.separator), lineWidth: 1.5)
                    )
                    .background(
                        RoundedRectangle(cornerRadius: borderRadius)
                            .fill(Color(.systemBackground))
                    )
                    .foregroundColor(.primary)
                    .frame(maxWidth: .infinity)
                    .onSubmit { isFocused = false }
            } else {
                ZStack(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(hintText ?? "")
                            .foregroundColor(.secondary)
                            .font(.custom("Avenir", size: 14))
                            .padding(.vertical, 10)
                            .padding(.horizontal, 14)
                            .allowsHitTesting(false)
                    }

                    TextEditor(text: $text)
                        .focused($isFocused)
                        .font(.custom("Avenir", size: 14))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(minHeight: 100, maxHeight: 150)
                        .frame(maxWidth: .infinity)
                        .background(Color.clear)
                        .scrollContentBackground(.hidden)
                        .foregroundColor(.primary)
                }
                .background(
                    RoundedRectangle(cornerRadius: borderRadius)
                        .strokeBorder(Color(.separator), lineWidth: 1.5)
                        .background(
                            RoundedRectangle(cornerRadius: borderRadius)
                                .fill(Color(.systemBackground))
                        )
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
    }
}
