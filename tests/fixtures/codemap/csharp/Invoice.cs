using System;
using System.Collections.Generic;
using static System.Math;
using Pay = Acme.Payments.Gateway;
using Acme.Billing.Models;

// class Commented { }
/* interface Hidden { void Gone(); } */

namespace Acme.Billing
{
    [Serializable]
    public class Invoice : BaseEntity, IPayable
    {
        public const int MaxLines = 50;
        private const string Prefix = "class Fake";
        private readonly List<Line> lines = new List<Line>();

        public string Number { get; set; }
        public decimal Total => ComputeTotal();
        public int Count { get { return lines.Count; } }

        public Invoice(string number) : base(number) { }

        public void Add(Line line)
        {
            if (line == null) throw new ArgumentNullException(nameof(line));
            lines.Add(line);
            Log.Write("added");
        }

        [Obsolete]
        public decimal ComputeTotal()
        {
            const int Scale = 2;
            return Round(Sum(lines), Scale);
        }

        internal static Invoice Parse(string text) => new Invoice(text);

        private void Hidden() { }

        public void Post()
        {
            using (var s = Open()) { }
            foreach (var l in lines) { Audit.Record(l); }
        }

        public class Line : IComparable<Line>
        {
            public int Quantity;
            public int CompareTo(Line other) { return 0; }
        }

        public enum Status { Draft, Sent }
    }

    public interface IPayable
    {
        decimal Total { get; }
        void Pay(decimal amount);
    }

    public record Receipt(string Id, decimal Amount) : IPayable;

    internal struct Money
    {
        public const string Currency = "USD";
    }

    public enum Level { Low, High }

    [Route("api/[controller]")]
    public sealed class Ledger : Base<Ledger>
    {
        public Ledger() { }

        public static T Pick<T>(IEnumerable<T> items) => items.First();

        public void Close() { Save(new Receipt("x", 1)); }
    }
}
