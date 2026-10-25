//! Keeps board tasks in memory for the tests.
use std::collections::HashMap;
use std::fmt::{self, Display as Show, Write};
use crate::board::task::{Task, Status};
use super::util;
use extlib::Decode;
mod helpers;
pub mod api {
    pub fn inner() {}
}

// fn commented_out() {}
/* struct Hidden;
   /* nested: fn nested() {} */
   fn still_hidden() {}
*/

const LIMIT: usize = 50;
pub static mut COUNTER: u32 = 0;
pub(crate) type Map = HashMap<String, Task>;

/// Keeps tasks by key.
pub struct Store {
    tasks: Map,
    limit: usize,
}

pub enum Mode {
    Fast,
    Slow,
}

pub trait Repo {
    fn get(&self, key: &str) -> Option<Task>;
    fn len(&self) -> usize { 0 }
}

impl Store {
    pub fn new(limit: usize) -> Self {
        Store { tasks: HashMap::new(), limit }
    }

    pub(crate) fn put(&mut self, key: &str, t: Task) {
        self.tasks.insert(key.to_string(), t);
        helpers::check(self.limit);
    }

    fn secret(&self) -> String {
        let s = "fn fake() {} struct Fake;";
        format!("{}", s)
    }
}

impl Repo for Store {
    fn get(&self, key: &str) -> Option<Task> {
        self.tasks.get(key).cloned()
    }
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "mode")
    }
}

pub const fn double(x: u32) -> u32 {
    x * 2
}

#[derive(Debug, Clone)]
struct Wrapper {
    inner: Store,
}

fn build() -> Store {
    let quote = '"';
    let mut s = Store::new(LIMIT);
    s.put("a", Task::default());
    util::log!("built {}", quote);
    api::inner();
    Some(s).unwrap()
}

impl<T: Clone> fmt::Debug
for Mode
where
    T: Clone,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "mode")
    }
}

use std::io::prelude::*;
