import SwiftUI
import SceneKit
import QuartzCore

// ─────────── Transparent SceneKit Wrapper ───────────
struct TransparentSceneView: UIViewRepresentable {
	let scene: SCNScene
	var allowsCameraControl: Bool = false
	var autoenablesDefaultLighting: Bool = false
	
	func makeUIView(context: Context) -> SCNView {
		let v = SCNView()
		v.scene = scene
		v.allowsCameraControl = allowsCameraControl
		v.autoenablesDefaultLighting = autoenablesDefaultLighting
		v.backgroundColor = .clear
		v.isOpaque = false
		v.antialiasingMode = .multisampling2X
		v.debugOptions = []
		return v
	}
	
	func updateUIView(_ v: SCNView, context: Context) {
		if v.scene !== scene { v.scene = scene }
		v.allowsCameraControl = allowsCameraControl
		v.autoenablesDefaultLighting = autoenablesDefaultLighting
		v.backgroundColor = .clear
		v.isOpaque = false
		v.antialiasingMode = .multisampling2X
		v.debugOptions = []
	}
}

// ─────────── TorusKnotView ───────────
struct TorusKnotView: View {
	var body: some View {
		GeometryReader { g in
			TransparentSceneView(
				scene: createScene(),
				allowsCameraControl: false,
				autoenablesDefaultLighting: false
			)
			.frame(width: min(g.size.width, 550), height: min(g.size.height, 550))
			.position(x: g.size.width / 2, y: g.size.height / 2)
			.background(Color.clear)
		}
		.background(Color.clear)
	}
	
	// ─────────── Scene ───────────
	private func createScene() -> SCNScene {
		let scene = SCNScene()
		scene.background.contents = UIColor.clear
		
		let cameraNode = SCNNode()
		cameraNode.camera = SCNCamera()
		cameraNode.position = SCNVector3(0, 0, 4.2)
		scene.rootNode.addChildNode(cameraNode)
		
		// Two independent knots (p=2,q=3). Slower spins + pulses.
		let knot1 = makeKnot(
			p: 2, q: 3,
			baseScale: 1.00,
			scaleRange: (0.94, 1.06),
			thicknessRange: (0.09, 0.16),
			scalePeriod: 9.0,     // slower (4.5 up + 4.5 down)
			thicknessPeriod: 9.0,
			phaseOffset: 0.0,
			spin1Axis: SCNVector3(0.0, 1.0, 0.15), spin1Period: 54.0,   // slower
			spin2Axis: SCNVector3(0.2, 0.6, 1.0),  spin2Period: 36.0
		)
		
		let knot2 = makeKnot(
			p: 2, q: 3,
			baseScale: 0.70,
			scaleRange: (0.93, 1.05),
			thicknessRange: (0.08, 0.15),
			scalePeriod: 10.8,    // slower, slightly different pace
			thicknessPeriod: 10.8,
			phaseOffset: 1.2,     // stagger
			spin1Axis: SCNVector3(1.0, 0.25, 0.0), spin1Period: 48.0,
			spin2Axis: SCNVector3(0.0, 0.0, 1.0),  spin2Period: 60.0
		)
		
		scene.rootNode.addChildNode(knot1)
		scene.rootNode.addChildNode(knot2)
		return scene
	}
	
	// Build a single animated knot wrapped in a parent "gimbal" so spins are independent.
	private func makeKnot(
		p: Int, q: Int,
		baseScale: Float,
		scaleRange: (Float, Float),
		thicknessRange: (CGFloat, CGFloat),
		scalePeriod: TimeInterval,
		thicknessPeriod: TimeInterval,
		phaseOffset: TimeInterval,
		spin1Axis: SCNVector3, spin1Period: TimeInterval,
		spin2Axis: SCNVector3, spin2Period: TimeInterval
	) -> SCNNode {
		let beige = UIColor(named: "Beige")?.resolvedColor(with: UIScreen.main.traitCollection)
		?? UIColor(red: 0.855, green: 0.843, blue: 0.773, alpha: 1.0)
		
		// “Old inner line” vibe: detailed but not too dense
		let tubularSegments = 240
		let radialSegments  = 12
		
		// Base (thin) + target (thick) share topology for smooth morphing
		let thin  = buildTorusKnotGeometry(p: p, q: q, major: 1.10, minor: 0.38, tube: thicknessRange.0,
										   tubularSegments: tubularSegments, radialSegments: radialSegments)
		let thick = buildTorusKnotGeometry(p: p, q: q, major: 1.10, minor: 0.38, tube: thicknessRange.1,
										   tubularSegments: tubularSegments, radialSegments: radialSegments)
		
		// Wireframe material
		let mat = SCNMaterial()
		mat.fillMode = .lines
		mat.isDoubleSided = false
		mat.lightingModel = .constant
		mat.diffuse.contents = beige
		mat.emission.contents = nil
		thin.materials  = [mat]
		thick.materials = [mat]
		
		let child = SCNNode(geometry: thin)
		let parent = SCNNode()
		parent.addChildNode(child)
		
		// Morph setup (controls thickness)
		let morpher = SCNMorpher()
		morpher.targets = [thick]
		child.morpher = morpher
		
		// Independent spins: parent + child on different axes/speeds
		let ax1 = normalized(spin1Axis)
		let ax2 = normalized(spin2Axis)
		parent.runAction(.repeatForever(.rotate(by: .pi * 2, around: ax1, duration: spin1Period)))
		child.runAction(.repeatForever(.rotate(by: .pi * 2, around: ax2, duration: spin2Period)))
		
		// --- Anti-phase pulse per knot ---
		// Start small & thick → grow thinner as it scales up.
		let minS = baseScale * scaleRange.0
		let maxS = baseScale * scaleRange.1
		child.scale = SCNVector3(minS, minS, minS)
		child.morpher?.setWeight(1.0, forTargetAt: 0) // thick at start
		
		// Thickness anim (morph weight 1 ↔ 0) with phase offset
		let thickness = CABasicAnimation(keyPath: "morpher.weights[0]")
		thickness.fromValue = 1.0
		thickness.toValue   = 0.0
		thickness.duration = thicknessPeriod
		thickness.autoreverses = true
		thickness.repeatCount = .infinity
		thickness.isRemovedOnCompletion = false
		thickness.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0.0, 0.2, 1.0)
		thickness.beginTime = CACurrentMediaTime() + phaseOffset
		child.addAnimation(thickness, forKey: "pulseThickness")
		
		// Whole-shape scale (minS ↔ maxS), opposite direction to thickness
		let ease: SCNActionTimingFunction = { t in t*t*(3 - 2*t) }
		let up   = SCNAction.scale(to: CGFloat(maxS), duration: scalePeriod / 2)
		up.timingFunction = ease
		let down = SCNAction.scale(to: CGFloat(minS), duration: scalePeriod / 2)
		down.timingFunction = ease
		let pulse = SCNAction.repeatForever(.sequence([up, down]))
		let delay = SCNAction.wait(duration: phaseOffset)
		child.runAction(.sequence([delay, pulse]), forKey: "pulseScale")
		
		return parent
	}
	
	// Build a tubular mesh along a (p,q) torus knot (triangles; rendered as wireframe via fillMode = .lines)
	private func buildTorusKnotGeometry(
		p: Int, q: Int,
		major: CGFloat, minor: CGFloat, tube: CGFloat,
		tubularSegments: Int, radialSegments: Int
	) -> SCNGeometry {
		let twoPi = CGFloat.pi * 2
		let dt = twoPi / CGFloat(tubularSegments)
		
		var verts: [SCNVector3] = []
		var norms: [SCNVector3] = []
		verts.reserveCapacity(tubularSegments * radialSegments)
		norms.reserveCapacity(tubularSegments * radialSegments)
		
		func center(_ t: CGFloat) -> SCNVector3 {
			let pt = CGFloat(p) * t
			let qt = CGFloat(q) * t
			let R  = major
			let r  = minor
			let cx = (R + r * cos(qt)) * cos(pt)
			let cy = (R + r * sin(qt)) * sin(pt)
			let cz = r * sin(qt)
			return SCNVector3(Float(cx), Float(cy), Float(cz))
		}
		
		func frame(at t: CGFloat) -> (T: SCNVector3, N: SCNVector3, B: SCNVector3) {
			let p0 = center(t - dt)
			let p1 = center(t + dt)
			var T  = normalize(p1 - p0)
			
			var up = SCNVector3(0, 0, 1)
			if abs(dot(T, up)) > Float(0.95) { up = SCNVector3(0, 1, 0) }
			
			var B = normalize(cross(T, up))
			if length(B) < Float(1e-5) { B = SCNVector3(1, 0, 0) }
			let N = normalize(cross(B, T))
			return (T, N, B)
		}
		
		for i in 0..<tubularSegments {
			let t = CGFloat(i) * dt
			let C = center(t)
			let (_, N, B) = frame(at: t)
			
			for j in 0..<radialSegments {
				let theta = twoPi * CGFloat(j) / CGFloat(radialSegments)
				let ct = Float(cos(theta))
				let st = Float(sin(theta))
				let ringDir = ct * B + st * N
				let pos = C + Float(tube) * ringDir
				verts.append(pos)
				norms.append(normalize(ringDir))
			}
		}
		
		var idx: [Int32] = []
		idx.reserveCapacity(tubularSegments * radialSegments * 6)
		for i in 0..<tubularSegments {
			let i1 = (i + 1) % tubularSegments
			for j in 0..<radialSegments {
				let j1 = (j + 1) % radialSegments
				let a = Int32(i  * radialSegments + j)
				let b = Int32(i1 * radialSegments + j)
				let c = Int32(i1 * radialSegments + j1)
				let d = Int32(i  * radialSegments + j1)
				idx += [a, b, c,  a, c, d]
			}
		}
		
		let srcPos = SCNGeometrySource(vertices: verts)
		let srcNrm = SCNGeometrySource(normals: norms)
		let elm    = SCNGeometryElement(indices: idx, primitiveType: .triangles)
		return SCNGeometry(sources: [srcPos, srcNrm], elements: [elm])
	}
	
	// ─────────── helpers ───────────
	private func normalized(_ v: SCNVector3) -> SCNVector3 {
		let L = max(length(v), Float(1e-6))
		return (1.0 / L) * v
	}
}

// ─────────── tiny vec helpers ───────────
private func +(lhs: SCNVector3, rhs: SCNVector3) -> SCNVector3 { .init(lhs.x+rhs.x, lhs.y+rhs.y, lhs.z+rhs.z) }
private func -(lhs: SCNVector3, rhs: SCNVector3) -> SCNVector3 { .init(lhs.x-rhs.x, lhs.y-rhs.y, lhs.z-rhs.z) }
private func *(lhs: Float, rhs: SCNVector3) -> SCNVector3 { .init(lhs*rhs.x, lhs*rhs.y, lhs*rhs.z) }
private func *(lhs: SCNVector3, rhs: Float) -> SCNVector3 { rhs * lhs }
private func dot(_ a: SCNVector3, _ b: SCNVector3) -> Float { a.x*b.x + a.y*b.y + a.z*b.z }
private func cross(_ a: SCNVector3, _ b: SCNVector3) -> SCNVector3 {
	.init(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x)
}
private func length(_ v: SCNVector3) -> Float { sqrt(dot(v, v)) }
private func normalize(_ v: SCNVector3) -> SCNVector3 {
	let L = max(length(v), Float(1e-6)); return (1.0 / L) * v
}
