package com.acme.billing;

import static com.acme.money.Money.zero;
import com.acme.money.Money;
import com.acme.tax.TaxRule;
import com.acme.util.*;
import java.util.ArrayList;
import java.util.List;
import javax.annotation.Nullable;

// public class Retired extends Invoice { void gone() { } }
/*
 * class AlsoRetired extends Invoice {
 *   void ghost() { }
 * }
 */

@Audited
public class Invoice extends Document implements Payable, Printable<Invoice> {

    public static final int MAX_LINES = 200;
    private static final long SEED = 7L;
    private static final String PREFIX = "class Fake extends Invoice";
    private static final String TEMPLATE = """
        class Phantom extends Invoice {
          void ghost() { helper(); }
        }
        """;

    private final List<Line> lines = new ArrayList<>();
    private Money total = zero();
    private int version;

    public Invoice(String number) {
        super(number);
    }

    @Override
    public String describe() {
        return "Invoice " + number() + " with " + lines.size() + " lines";
    }

    public void add(Line line) {
        if (lines.size() >= MAX_LINES) {
            throw new IllegalStateException("full");
        }
        lines.add(line);
        recount();
    }

    public void note(@Nullable String text) {
        char quote = '"';
        String after = Format.wrap(text, quote);
        version++;
    }

    private void recount() {
        total = zero();
        for (Line line : lines) {
            total = total.plus(TaxRule.apply(line.amount()));
        }
    }

    static <T> T firstOr(List<T> items, T fallback) {
        return items.isEmpty() ? fallback : items.get(0);
    }

    public static class Builder {
        private String number = "";

        public Builder number(String value) {
            this.number = Objects.requireNonNull(value);
            return this;
        }

        public Invoice build() {
            return new Invoice(number);
        }
    }

    public interface Visitor {
        void visit(Line line);

        interface Deep {
            void deepMethod();
        }
    }

    public enum Status { OPEN, PAID }

    public record Line(String sku, int qty) implements Printable<Line> {
        public int amount() {
            return qty * 100;
        }
    }
}

record Discount(String code, double rate) {
    double applyTo(double amount) {
        return amount * (1 - rate);
    }
    public int getX() { return x; }
    void n() {}
}
