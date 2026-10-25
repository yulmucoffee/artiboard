package com.acme.orders

import com.acme.money.Money
import com.acme.tax.TaxRule
import com.acme.util.*
import com.acme.util.Formatter as Fmt
import javax.inject.Inject

// class Retired : Order() { fun gone() = Unit }
/*
 * data class Ghost(val id: Int)
 * /* nested comment with class Hidden */
fun hidden() {}
 */

const val MAX_ITEMS = 50
private const val SECRET = "class Fake : Order()"
val defaultCurrency = "EUR"
var retries = 3

@Audited
open class Order(val id: String) : Document(id), Payable, Printable {

    private val items = mutableListOf<Line>()

    fun add(line: Line) {
        if (items.size >= MAX_ITEMS) throw IllegalStateException("full")
        items.add(line)
        recount()
    }

    fun total(): Money = items.fold(Money.zero()) { acc, line -> acc + TaxRule.apply(line.amount()) }

    private fun recount() {
        val raw = """
            class Phantom : Order("x") {
              fun ghost() = helper()
            }
        """.trimIndent()
        println(raw.length)
    }

    fun String.shout(): String = uppercase() + "!"

    @Inject
    internal fun wire(fmt: Fmt) {
        Fmt.format(id)
    }

    companion object {
        const val VERSION = 2
        fun create(id: String): Order = Order(id)
    }

    class Line(val sku: String, val qty: Int) {
        fun amount(): Int = qty * 100
    }

    class Deep {
        class Deeper {
            fun hidden() {}
        }
    }
}

data class Point(val x: Int, val y: Int)

class Invoice(
    val number: String,
    private val tax: TaxRule,
) : Document(number),
    Auditable {
    fun pay() = Unit
}

interface Shape : Printable {
    fun area(): Double
}

enum class Status {
    OPEN, PAID;

    fun label(): String = name.lowercase()
}

sealed class Outcome {
    object Done : Outcome()
}

object Registry {
    fun lookup(key: String): Order? = null
}

fun main(args: Array<String>) {
    val order = Order("a")
    order.add(Order.Line("x", 1))
}
