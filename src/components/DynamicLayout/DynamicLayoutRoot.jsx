export default function DynamicLayoutRoot({ className, style, children, ...rest }) {
  return (
    <div className={className} style={style} {...rest}>
      {children}
    </div>
  )
}
