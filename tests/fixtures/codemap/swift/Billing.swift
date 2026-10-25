import Foundation
import struct Core.Models
@testable import Billing

// class Commented {}
/* protocol Hidden {
   /* nested comment with struct Fake */
   func stillHidden()
} */

let defaultRate = 0.2
var counter = 0
private let secret = "class Fake"

typealias Amount = Double

protocol Payable: AnyObject {
    var total: Double { get }
    func pay(amount: Double) -> Bool
}

@objc
public class Invoice: NSObject, Payable {
    public static let maxLines = 50
    private var lines: [Line] = []

    public var total: Double {
        lines.reduce(0) { $0 + $1.amount }
    }

    public init(number: String) {
        super.init()
    }

    public func pay(amount: Double) -> Bool {
        guard amount > 0 else { return false }
        log("paying \(amount)")
        return Receipt(total: amount).isValid
    }

    private func audit() {
        let rate = Rates.current(for: "eur")
        print(rate)
    }

    public struct Line {
        public let amount: Double
        func describe() -> String { "\(amount)" }
    }

    public enum Status: String {
        case draft, sent
        case paid(Double)
    }
}

extension Invoice: CustomStringConvertible {
    public var description: String { "invoice" }
    func summary() -> String { return "x" }
}

struct Receipt {
    var isValid: Bool
    init(total: Double) { self.isValid = total > 0 }
}

enum Rates {
    case eur
    static func current(for code: String) -> Double { return 1.0 }
}

@MainActor
func makeInvoice(number: String) -> Invoice {
    let text = """
    multi-line string with class Fake
    and "quotes" and \(number)
    """
    return Invoice(number: text)
}

private func helper() {}
