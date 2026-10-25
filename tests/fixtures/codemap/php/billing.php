<?php
declare(strict_types=1);

namespace App\Billing;

use App\Models\User;
use App\Models\Invoice as Bill;
use App\Support\{Money, Clock as Tick};
use function App\Support\format_date;
use Vendor\Lib\Str;
require_once 'config/paths.php';
include "views/footer.php";

// class Ghost extends User {}
# function ghost() {}
/* interface Phantom {}
   const GHOST = 1; */

const RATE = 0.2;
define('LEGACY', 1); // not a symbol

interface Chargeable extends Payable, Countable
{
    public function charge(int $cents): bool;
}

trait Logs
{
    public function log(string $msg): void
    {
        echo "class Fake extends Nope { function fake() }";
        $this->sink->write($msg);
    }
}

abstract class Gateway extends BaseGateway implements Chargeable, \Countable
{
    use Logs, Retries;

    public const TIMEOUT = 30;
    private const SECRET = 'x';

    protected function send(string $body): string
    {
        $text = <<<EOT
        function heredoc_fake() {
        EOT;
        return Str::upper($body);
    }

    public static function make(): static
    {
        return new static(new Tick());
    }

    private function sign(): void {}

    public function charge(int $cents): bool
    {
        $m = Money::from($cents);
        $this->send((string) $m);
        return Bill::create($m)->save();
    }
}

final class Invoice extends Model
{
    public function total(): float
    {
        $fn = function ($x) use ($rate) { return $x * RATE; };
        return format_date(Tick::now()) . User::find(1)?->name;
    }
}

enum Status: string
{
    case Paid = 'paid';
}

function settle(Gateway $gw, Invoice $inv): void
{
    $gw->charge(100);
    if ($inv->total() > 0) {
        new Invoice();
    }
    Logger::info('done');
}

return ['a' => 'x'];
?>
