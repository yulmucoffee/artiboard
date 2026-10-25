# frozen_string_literal: true

require 'json'
require 'billing/invoice'
require_relative '../models/order'
load 'config/rates.rb'

=begin
def retired_helper
class LegacyQuote < Base
=end

# def commented_out(order)
#   Quote.new(order)
# end

module Shipping
  RATE_TABLE = { ground: 4.5, air: 19.0 }.freeze
  NOTE = "class Ghost < Base; def phantom; end"

  class Quote < Base
    include Comparable
    extend Forwardable

    def initialize(order, mode = :ground)
      @order = order
      @mode = mode
    end

    def price
      rate = RATE_TABLE.fetch(@mode)
      base_fee(rate) + Invoice.new(@order).total
    end

    def self.for(order)
      new(order, :air)
    end

    class << self
      def default_mode
        :ground
      end
    end

    private

    def base_fee(rate)
      rate * @order.weight
    end
  end

  def self.rate_for(mode)
    RATE_TABLE.fetch(mode)
  end
end

class Courier
  include Shipping::Helpers
  DEFAULT_SERVICE = 'ground'

  def self.services = %w[ground air].map(&:to_sym)

  def dispatch(order)
    text = <<~MSG
      def ghost; end
      Quote.new(order)
    MSG
    puts text
    orders.each do |item|
      Shipping::Quote.new(item).price if item.ready?
    end
    Shipping::Quote.for(order)
  end
end
