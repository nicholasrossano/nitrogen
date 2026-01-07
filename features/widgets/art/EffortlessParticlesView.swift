import SwiftUI
import UIKit
import MetalKit
import Metal
import simd

// ─────────── SwiftUI wrapper ───────────
struct EffortlessParticlesView: View {
	var body: some View {
		MetalParticleView()
			.ignoresSafeArea()
	}
}

// ─────────── UIViewRepresentable ───────────
struct MetalParticleView: UIViewRepresentable {
	func makeUIView(context: Context) -> MTKView {
		let view = MTKView()
		view.device = MTLCreateSystemDefaultDevice()
		view.delegate = context.coordinator
		view.preferredFramesPerSecond = 60
		view.enableSetNeedsDisplay = false
		view.isPaused = false
		view.isOpaque = false
		view.backgroundColor = .clear
		view.layer.backgroundColor = UIColor.clear.cgColor
		view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
		
		context.coordinator.setupMetal(for: view)
		context.coordinator.setupBuffers()
		return view
	}
	
	func updateUIView(_ uiView: MTKView, context: Context) {}
	func makeCoordinator() -> Coordinator { Coordinator() }
	
	// ─────────── MTKViewDelegate ───────────
	class Coordinator: NSObject, MTKViewDelegate {
		private var device: MTLDevice!
		private var queue:  MTLCommandQueue!
		private var pipeline: MTLRenderPipelineState!
		
		private var vb, cb, sb, ub: MTLBuffer!
		
		private let n = 20_000
		private let start = CACurrentMediaTime()
		
		private lazy var beige: SIMD3<Float> = {
			if let c = UIColor(named: "Beige")?.cgColor.components, c.count >= 3 {
				return SIMD3(Float(c[0]), Float(c[1]), Float(c[2]))
			}
			return SIMD3(0.854, 0.843, 0.773)
		}()
		
		struct Uniforms { var time: Float; var opacity: Float; var proj: matrix_float4x4 }
		
		// ─────────── setup ───────────
		func setupMetal(for v: MTKView) {
			device = v.device
			queue  = device.makeCommandQueue()
			
			let lib: MTLLibrary
			if let compiled = device.makeDefaultLibrary() {
				lib = compiled
			} else if let built = try? device.makeLibrary(source: metalShaders, options: nil) {
				lib = built
			} else {
				fatalError("Unable to create Metal library.")
			}
			
			let desc = MTLRenderPipelineDescriptor()
			desc.vertexFunction   = lib.makeFunction(name: "vertex_main")
			desc.fragmentFunction = lib.makeFunction(name: "fragment_main")
			desc.colorAttachments[0].pixelFormat = v.colorPixelFormat
			desc.colorAttachments[0].isBlendingEnabled = true
			desc.colorAttachments[0].rgbBlendOperation = .add
			desc.colorAttachments[0].alphaBlendOperation = .add
			desc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
			desc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
			desc.colorAttachments[0].sourceAlphaBlendFactor = .sourceAlpha
			desc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
			
			pipeline = try! device.makeRenderPipelineState(descriptor: desc)
		}
		
		func setupBuffers() {
			var pos = [SIMD3<Float>]()
			var col = [SIMD3<Float>]()
			var size = [Float]()
			
			for i in 0..<n {
				let layer = Float(i / (n/5)) - 2
				let t = Float(i % (n/5)) / Float(n/5)
				let r = sqrt(t) * 3
				let a = t * .pi * 15
				pos.append(SIMD3(cos(a)*r, layer*1.2, sin(a)*r))
				
				let v = Float.random(in: 0...0.05)
				col.append(beige - SIMD3<Float>(repeating: v))
				size.append(0.12 + .random(in: 0...0.04))
			}
			
			vb = device.makeBuffer(bytes: pos,  length: pos.count  * MemoryLayout<SIMD3<Float>>.size)
			cb = device.makeBuffer(bytes: col,  length: col.count  * MemoryLayout<SIMD3<Float>>.size)
			sb = device.makeBuffer(bytes: size, length: size.count * MemoryLayout<Float>.size)
			ub = device.makeBuffer(length: MemoryLayout<Uniforms>.size)
		}
		
		// ─────────── delegate ───────────
		func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
		
		func draw(in v: MTKView) {
			guard
				let drawable = v.currentDrawable,
				let pass     = v.currentRenderPassDescriptor,
				let cmdBuf   = queue.makeCommandBuffer(),
				let enc      = cmdBuf.makeRenderCommandEncoder(descriptor: pass)
			else { return }
			
			var u = Uniforms(
				time: Float(CACurrentMediaTime() - start),
				opacity: 0.9,
				proj: matrix_perspective_right_hand(
					fovyRadians: 75 * .pi / 180,
					aspectRatio: Float(v.bounds.width / v.bounds.height),
					nearZ: 0.1, farZ: 1000)
			)
			ub.contents().copyMemory(from: &u, byteCount: MemoryLayout.size(ofValue: u))
			
			enc.setRenderPipelineState(pipeline)
			enc.setVertexBuffer(vb, offset: 0, index: 0)
			enc.setVertexBuffer(cb, offset: 0, index: 1)
			enc.setVertexBuffer(sb, offset: 0, index: 2)
			enc.setVertexBuffer(ub, offset: 0, index: 3)
			enc.setFragmentBuffer(ub, offset: 0, index: 0) // bind uniforms for fragment stage
			enc.drawPrimitives(type: .point, vertexStart: 0, vertexCount: n)
			enc.endEncoding()
			
			cmdBuf.present(drawable)
			cmdBuf.commit()
		}
	}
}

// ─────────── Matrix helper ───────────
func matrix_perspective_right_hand(fovyRadians f: Float,
								   aspectRatio a: Float,
								   nearZ n: Float,
								   farZ fz: Float) -> matrix_float4x4 {
	let ys = 1 / tanf(f * 0.5)
	let xs = ys / a
	let zs = fz / (n - fz)
	return matrix_float4x4(columns: (
		SIMD4(xs, 0, 0, 0),
		SIMD4(0, ys, 0, 0),
		SIMD4(0, 0, zs, n * zs),
		SIMD4(0, 0, -1, 0)
	))
}

let metalShaders = """
#include <metal_stdlib>
using namespace metal;

struct VertexOut {
	float4 position [[position]];
	float3 color;
	float  pointSize [[point_size]];
};

struct Uniforms {
	float     time;
	float     opacity;
	float4x4  projectionMatrix;
};

vertex VertexOut vertex_main(uint vid [[vertex_id]],
							 device float3* positions [[buffer(0)]],
							 device float3* colours   [[buffer(1)]],
							 device float*  sizes     [[buffer(2)]],
							 constant Uniforms& u     [[buffer(3)]])
{
	float3 pos = positions[vid];

	float t = u.time * 0.2;
	float r = length(pos.xz);
	float a = atan2(pos.z, pos.x);
	float flow = sin(t + r*2.0 - a) * cos(t*0.7 + a*3.0);

	float layer      = floor(pos.y*2.0)*0.5;
	float layerPhase = t + layer;

	pos += float3(cos(layerPhase) * sin(t*0.5 + pos.z) * 0.5,
				  sin(layerPhase*0.7) * 0.3,
				  sin(layerPhase) * cos(t*0.5 + pos.x) * 0.5)
		   * (1.0 + flow*0.3);
	pos *= 0.6;

	// Move in front of the camera (right-handed; camera looks down -Z)
	pos.z -= 5.0;

	VertexOut out;
	out.position  = u.projectionMatrix * float4(pos, 1.0);
	out.color     = colours[vid];
	out.pointSize = sizes[vid] * (192.0 / max(1.0, -pos.z)); // positive, stable
	return out;
}

fragment float4 fragment_main(VertexOut in [[stage_in]],
							  float2 pc [[point_coord]],
							  constant Uniforms& u [[buffer(0)]])
{
	float d = distance(pc, float2(0.5));
	if (d > 0.5) discard_fragment();
	float alpha = (1.0 - smoothstep(0.45, 0.5, d)) * u.opacity;
	return float4(in.color, alpha);
}
"""
