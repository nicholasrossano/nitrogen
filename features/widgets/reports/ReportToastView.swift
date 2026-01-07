// ─────────── ReportToastView.swift ───────────
import SwiftUI

struct ReportToastView: View {
	var body: some View {
		GeometryReader { geo in
			HStack(spacing: 8) {
				Image(systemName: "flag.fill")
					.font(.system(size: 16, weight: .semibold))
				Text("Your report has been submitted")
					.font(.subheadline)
			}
			.foregroundColor(.primary)
			.padding(.vertical, 12)
			.padding(.horizontal, 16)
			.frame(maxWidth: .infinity)
			.background(.thinMaterial)
			.clipShape(
				RoundedRectangle(
					cornerRadius: 20,
					style: .continuous
				)
			)
			.shadow(radius: 4)
			.padding(.horizontal, 40)
		}
		.frame(height: 50)
	}
}
