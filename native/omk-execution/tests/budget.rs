use omk_execution_host::budget::{Budget, Stop};

#[test]
fn exact_byte_limit_is_allowed_but_the_next_byte_is_not() {
    let mut budget = Budget::new(100, 10).expect("valid budget");
    assert_eq!(budget.observe(0, 10), None);
    assert_eq!(budget.retained(), 10);
    assert_eq!(budget.observe(1, 1), Some(Stop::OutputLimit));
    assert_eq!(budget.retained(), 10);
    assert_eq!(budget.observe(0, 0), Some(Stop::OutputLimit));
}

#[test]
fn timeout_boundary_precedes_output_and_is_latched() {
    let mut budget = Budget::new(100, 10).expect("valid budget");
    assert_eq!(budget.observe(99, 9), None);
    assert_eq!(budget.observe(100, 2), Some(Stop::Deadline));
    assert_eq!(budget.observe(1, 1), Some(Stop::Deadline));
    assert_eq!(budget.retained(), 9);
}

#[test]
fn regression_and_overflow_fail_without_exceeding_retention() {
    let mut budget = Budget::new(100, 10).expect("valid budget");
    assert_eq!(budget.observe(10, 1), None);
    assert_eq!(budget.observe(9, 1), Some(Stop::ClockRegression));
    assert_eq!(budget.retained(), 1);
    let mut budget = Budget::new(100, 10).expect("valid budget");
    assert_eq!(budget.observe(0, u64::MAX), Some(Stop::OutputLimit));
    assert_eq!(budget.retained(), 0);
}

#[test]
fn invalid_budget_is_rejected() {
    assert!(Budget::new(0, 1).is_err());
    assert!(Budget::new(86_400_001, 1).is_err());
    assert!(Budget::new(1, 16_777_217).is_err());
    assert!(Budget::new(1, 0).is_ok());
}
