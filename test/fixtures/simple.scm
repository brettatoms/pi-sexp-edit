;;; A simple Scheme file

(define pi 3.14159)

;; Calculate area of a circle
(define (circle-area radius)
  (* pi radius radius))

(define (greet name)
  (string-append "Hello, " name "!"))

#|
This is a block comment.
It can span multiple lines.
#| And it can be nested. |#
|#

(define-record-type <point>
  (make-point x y)
  point?
  (x point-x)
  (y point-y))

(define-syntax my-when
  (syntax-rules ()
    ((my-when test body ...)
     (if test (begin body ...)))))
